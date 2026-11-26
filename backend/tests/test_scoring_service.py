import pytest
from unittest.mock import MagicMock, patch
from backend.app.services.scoring_service import (
    calculate_data_quality_score,
    persist_data_quality_score,
    SCORING_VERSION,
)

_VALID_OPP_ID = "aabbccdd-1234-5678-abcd-000000000001"


def _score(**overrides):
    defaults = {
        "source_type": "official_careers",
        "has_contact_role": True,
        "verification_status": "deliverable",
        "published_days_ago": 1,
        "has_description": True,
        "has_salary": True,
        "has_location": True,
        "is_suppressed": False,
    }
    defaults.update(overrides)
    return calculate_data_quality_score(**defaults)


def _make_mock_transaction():
    mock_cur = MagicMock()
    mock_conn = MagicMock()
    mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cur)
    mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)
    mock_transaction = MagicMock()
    mock_transaction.return_value.__enter__ = MagicMock(return_value=mock_conn)
    mock_transaction.return_value.__exit__ = MagicMock(return_value=False)
    return mock_transaction, mock_cur


class TestMaximumScore:
    def test_all_best_inputs_score_100(self):
        result = _score()
        assert result["score"] == 100

    def test_all_best_inputs_band_high(self):
        result = _score()
        assert result["band"] == "high"

    def test_all_best_inputs_eligible(self):
        result = _score()
        assert result["is_eligible"] is True


class TestMinimumScore:
    def test_all_worst_inputs_score_is_nonnegative(self):
        result = _score(
            source_type="aggregator",
            has_contact_role=False,
            verification_status="undeliverable",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["score"] >= 0

    def test_all_worst_inputs_band_low(self):
        result = _score(
            source_type="aggregator",
            has_contact_role=False,
            verification_status="undeliverable",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["band"] == "low"

    def test_all_worst_inputs_not_eligible(self):
        result = _score(
            source_type="aggregator",
            has_contact_role=False,
            verification_status="undeliverable",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["is_eligible"] is False


class TestSourceReliabilityFactor:
    def test_official_careers_gives_25(self):
        result = _score(source_type="official_careers")
        assert result["factor_breakdown"]["source_reliability"] == 25

    def test_verified_portal_gives_20(self):
        result = _score(source_type="verified_portal")
        assert result["factor_breakdown"]["source_reliability"] == 20

    def test_aggregator_gives_12(self):
        result = _score(source_type="aggregator")
        assert result["factor_breakdown"]["source_reliability"] == 12

    def test_unknown_source_type_gives_12(self):
        result = _score(source_type="something_unknown")
        assert result["factor_breakdown"]["source_reliability"] == 12

    def test_unknown_source_type_uses_unknown_reason_code(self):
        result = _score(source_type="something_unknown")
        codes = [r["code"] for r in result["reasons"]]
        assert "UNKNOWN_SOURCE" in codes
        assert "AGGREGATOR_SOURCE" not in codes

    def test_empty_source_type_gives_12_and_unknown_reason_code(self):
        result = _score(source_type="")
        assert result["factor_breakdown"]["source_reliability"] == 12
        codes = [r["code"] for r in result["reasons"]]
        assert "UNKNOWN_SOURCE" in codes

    def test_aggregator_source_uses_aggregator_reason_code(self):
        result = _score(source_type="aggregator")
        codes = [r["code"] for r in result["reasons"]]
        assert "AGGREGATOR_SOURCE" in codes
        assert "UNKNOWN_SOURCE" not in codes

    def test_source_score_never_exceeds_25(self):
        for src in ("official_careers", "verified_portal", "aggregator", "other"):
            result = _score(source_type=src)
            assert result["factor_breakdown"]["source_reliability"] <= 25

    def test_official_careers_reason_code(self):
        result = _score(source_type="official_careers")
        codes = [r["code"] for r in result["reasons"]]
        assert "OFFICIAL_COMPANY_SOURCE" in codes

    def test_verified_portal_reason_code(self):
        result = _score(source_type="verified_portal")
        codes = [r["code"] for r in result["reasons"]]
        assert "VERIFIED_PORTAL_SOURCE" in codes


class TestOrgContactAssociationFactor:
    def test_contact_role_true_gives_25(self):
        result = _score(has_contact_role=True)
        assert result["factor_breakdown"]["organization_association"] == 25

    def test_contact_role_false_gives_10(self):
        result = _score(has_contact_role=False)
        assert result["factor_breakdown"]["organization_association"] == 10

    def test_contact_role_none_gives_10(self):
        result = _score(has_contact_role=None)
        assert result["factor_breakdown"]["organization_association"] == 10

    def test_contact_role_integer_1_gives_10(self):
        result = _score(has_contact_role=1)
        assert result["factor_breakdown"]["organization_association"] == 10

    def test_contact_role_string_true_gives_10(self):
        result = _score(has_contact_role="true")
        assert result["factor_breakdown"]["organization_association"] == 10

    def test_association_score_never_exceeds_25(self):
        for val in (True, False, None, 1, 0):
            result = _score(has_contact_role=val)
            assert result["factor_breakdown"]["organization_association"] <= 25

    def test_contact_role_confirmed_reason_code(self):
        result = _score(has_contact_role=True)
        codes = [r["code"] for r in result["reasons"]]
        assert "CONTACT_ROLE_CONFIRMED" in codes

    def test_contact_role_unconfirmed_reason_code(self):
        result = _score(has_contact_role=False)
        codes = [r["code"] for r in result["reasons"]]
        assert "CONTACT_ROLE_UNCONFIRMED" in codes


class TestContactVerificationFactor:
    def test_deliverable_gives_20(self):
        result = _score(verification_status="deliverable")
        assert result["factor_breakdown"]["contact_verification"] == 20

    def test_catch_all_gives_10(self):
        result = _score(verification_status="catch_all")
        assert result["factor_breakdown"]["contact_verification"] == 10

    def test_risky_gives_5(self):
        result = _score(verification_status="risky")
        assert result["factor_breakdown"]["contact_verification"] == 5

    def test_undeliverable_gives_0(self):
        result = _score(verification_status="undeliverable")
        assert result["factor_breakdown"]["contact_verification"] == 0

    def test_unknown_gives_0(self):
        result = _score(verification_status="unknown")
        assert result["factor_breakdown"]["contact_verification"] == 0

    def test_failed_gives_0(self):
        result = _score(verification_status="failed")
        assert result["factor_breakdown"]["contact_verification"] == 0

    def test_invalid_string_gives_0(self):
        result = _score(verification_status="garbage_value")
        assert result["factor_breakdown"]["contact_verification"] == 0

    def test_none_verification_gives_0(self):
        result = _score(verification_status=None)
        assert result["factor_breakdown"]["contact_verification"] == 0

    def test_verification_score_never_exceeds_20(self):
        for status in ("deliverable", "catch_all", "risky", "unknown", "undeliverable", "failed"):
            result = _score(verification_status=status)
            assert result["factor_breakdown"]["contact_verification"] <= 20

    def test_deliverable_reason_code(self):
        result = _score(verification_status="deliverable")
        codes = [r["code"] for r in result["reasons"]]
        assert "EMAIL_VERIFIED_DELIVERABLE" in codes

    def test_catch_all_reason_code(self):
        result = _score(verification_status="catch_all")
        codes = [r["code"] for r in result["reasons"]]
        assert "EMAIL_CATCH_ALL" in codes

    def test_risky_reason_code(self):
        result = _score(verification_status="risky")
        codes = [r["code"] for r in result["reasons"]]
        assert "EMAIL_RISKY" in codes

    def test_unverified_reason_code(self):
        result = _score(verification_status="undeliverable")
        codes = [r["code"] for r in result["reasons"]]
        assert "EMAIL_UNVERIFIED" in codes


class TestDataFreshnessFactor:
    def test_zero_days_gives_15(self):
        result = _score(published_days_ago=0)
        assert result["factor_breakdown"]["data_freshness"] == 15

    def test_3_days_gives_15(self):
        result = _score(published_days_ago=3)
        assert result["factor_breakdown"]["data_freshness"] == 15

    def test_4_days_gives_10(self):
        result = _score(published_days_ago=4)
        assert result["factor_breakdown"]["data_freshness"] == 10

    def test_14_days_gives_10(self):
        result = _score(published_days_ago=14)
        assert result["factor_breakdown"]["data_freshness"] == 10

    def test_15_days_gives_5(self):
        result = _score(published_days_ago=15)
        assert result["factor_breakdown"]["data_freshness"] == 5

    def test_large_days_gives_5(self):
        result = _score(published_days_ago=365)
        assert result["factor_breakdown"]["data_freshness"] == 5

    def test_none_gives_0(self):
        result = _score(published_days_ago=None)
        assert result["factor_breakdown"]["data_freshness"] == 0

    def test_negative_gives_0(self):
        result = _score(published_days_ago=-1)
        assert result["factor_breakdown"]["data_freshness"] == 0

    def test_bool_true_gives_0(self):
        result = _score(published_days_ago=True)
        assert result["factor_breakdown"]["data_freshness"] == 0

    def test_bool_false_gives_0(self):
        result = _score(published_days_ago=False)
        assert result["factor_breakdown"]["data_freshness"] == 0

    def test_freshness_score_never_exceeds_15(self):
        for days in (0, 1, 3, 4, 14, 15, 100, None, -5):
            result = _score(published_days_ago=days)
            assert result["factor_breakdown"]["data_freshness"] <= 15

    def test_very_fresh_reason_code(self):
        result = _score(published_days_ago=2)
        codes = [r["code"] for r in result["reasons"]]
        assert "DATA_VERY_FRESH" in codes

    def test_moderately_fresh_reason_code(self):
        result = _score(published_days_ago=10)
        codes = [r["code"] for r in result["reasons"]]
        assert "DATA_MODERATELY_FRESH" in codes

    def test_aged_reason_code(self):
        result = _score(published_days_ago=30)
        codes = [r["code"] for r in result["reasons"]]
        assert "DATA_AGED" in codes

    def test_unknown_freshness_reason_code(self):
        result = _score(published_days_ago=None)
        codes = [r["code"] for r in result["reasons"]]
        assert "DATA_FRESHNESS_UNKNOWN" in codes


class TestCompletenessFactor:
    def test_all_fields_gives_15(self):
        result = _score(has_description=True, has_salary=True, has_location=True)
        assert result["factor_breakdown"]["completeness"] == 15

    def test_no_fields_gives_0(self):
        result = _score(has_description=False, has_salary=False, has_location=False)
        assert result["factor_breakdown"]["completeness"] == 0

    def test_description_only_gives_7(self):
        result = _score(has_description=True, has_salary=False, has_location=False)
        assert result["factor_breakdown"]["completeness"] == 7

    def test_salary_only_gives_4(self):
        result = _score(has_description=False, has_salary=True, has_location=False)
        assert result["factor_breakdown"]["completeness"] == 4

    def test_location_only_gives_4(self):
        result = _score(has_description=False, has_salary=False, has_location=True)
        assert result["factor_breakdown"]["completeness"] == 4

    def test_description_and_salary_gives_11(self):
        result = _score(has_description=True, has_salary=True, has_location=False)
        assert result["factor_breakdown"]["completeness"] == 11

    def test_description_and_location_gives_11(self):
        result = _score(has_description=True, has_salary=False, has_location=True)
        assert result["factor_breakdown"]["completeness"] == 11

    def test_salary_and_location_gives_8(self):
        result = _score(has_description=False, has_salary=True, has_location=True)
        assert result["factor_breakdown"]["completeness"] == 8

    def test_has_description_integer_1_gives_0(self):
        result = _score(has_description=1, has_salary=False, has_location=False)
        assert result["factor_breakdown"]["completeness"] == 0

    def test_has_salary_string_true_gives_0(self):
        result = _score(has_description=False, has_salary="yes", has_location=False)
        assert result["factor_breakdown"]["completeness"] == 0

    def test_has_location_none_gives_0(self):
        result = _score(has_description=False, has_salary=False, has_location=None)
        assert result["factor_breakdown"]["completeness"] == 0

    def test_completeness_score_never_exceeds_15(self):
        for d, s, l in ((True, True, True), (False, False, False), (True, False, True)):
            result = _score(has_description=d, has_salary=s, has_location=l)
            assert result["factor_breakdown"]["completeness"] <= 15

    def test_completeness_reason_code_present(self):
        result = _score(has_description=True, has_salary=True, has_location=True)
        codes = [r["code"] for r in result["reasons"]]
        assert "COMPLETENESS_SCORE" in codes


class TestBandClassification:
    def test_score_80_is_high(self):
        result = _score(
            source_type="official_careers",
            has_contact_role=True,
            verification_status="deliverable",
            published_days_ago=10,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["score"] == 80
        assert result["band"] == "high"

    def test_score_79_is_medium(self):
        result = _score(
            source_type="official_careers",
            has_contact_role=True,
            verification_status="deliverable",
            published_days_ago=15,
            has_description=False,
            has_salary=False,
            has_location=True,
        )
        assert result["score"] == 79
        assert result["band"] == "medium"

    def test_score_60_is_medium(self):
        result = _score(
            source_type="official_careers",
            has_contact_role=True,
            verification_status="catch_all",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["score"] == 60
        assert result["band"] == "medium"

    def test_score_59_is_low(self):
        result = _score(
            source_type="official_careers",
            has_contact_role=True,
            verification_status="risky",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=True,
        )
        assert result["score"] == 59
        assert result["band"] == "low"

    def test_score_100_is_high(self):
        result = _score()
        assert result["score"] == 100
        assert result["band"] == "high"


class TestSuppressionBehavior:
    def test_suppressed_band_regardless_of_high_score(self):
        result = _score(is_suppressed=True)
        assert result["score"] == 100
        assert result["band"] == "suppressed"

    def test_suppressed_not_eligible(self):
        result = _score(is_suppressed=True)
        assert result["is_eligible"] is False

    def test_suppressed_low_score_still_suppressed(self):
        result = _score(
            source_type="aggregator",
            has_contact_role=False,
            verification_status="unknown",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
            is_suppressed=True,
        )
        assert result["band"] == "suppressed"

    def test_unsuppressed_high_score_is_high(self):
        result = _score(is_suppressed=False)
        assert result["band"] == "high"
        assert result["is_eligible"] is True

    def test_is_suppressed_integer_1_does_not_suppress(self):
        result = _score(is_suppressed=1)
        assert result["band"] == "high"

    def test_is_suppressed_string_true_does_not_suppress(self):
        result = _score(is_suppressed="true")
        assert result["band"] == "high"

    def test_is_suppressed_none_does_not_suppress(self):
        result = _score(is_suppressed=None)
        assert result["band"] == "high"


class TestDeterminism:
    def test_same_inputs_produce_same_score_twice(self):
        kwargs = {
            "source_type": "verified_portal",
            "has_contact_role": True,
            "verification_status": "catch_all",
            "published_days_ago": 7,
            "has_description": True,
            "has_salary": False,
            "has_location": True,
        }
        result1 = calculate_data_quality_score(**kwargs)
        result2 = calculate_data_quality_score(**kwargs)
        assert result1["score"] == result2["score"]
        assert result1["band"] == result2["band"]
        assert result1["factor_breakdown"] == result2["factor_breakdown"]
        assert result1["scoring_version"] == result2["scoring_version"]

    def test_no_scored_at_in_output(self):
        result = _score()
        assert "scored_at" not in result

    def test_repeated_calls_produce_identical_reasons(self):
        kwargs = {
            "source_type": "official_careers",
            "has_contact_role": False,
            "verification_status": "risky",
            "published_days_ago": 20,
            "has_description": True,
            "has_salary": True,
            "has_location": False,
        }
        r1 = calculate_data_quality_score(**kwargs)
        r2 = calculate_data_quality_score(**kwargs)
        assert r1["reasons"] == r2["reasons"]


class TestOutputStructure:
    def test_score_in_output(self):
        result = _score()
        assert "score" in result

    def test_band_in_output(self):
        result = _score()
        assert "band" in result

    def test_is_eligible_in_output(self):
        result = _score()
        assert "is_eligible" in result

    def test_reasons_in_output(self):
        result = _score()
        assert "reasons" in result

    def test_factor_breakdown_in_output(self):
        result = _score()
        assert "factor_breakdown" in result

    def test_scoring_version_in_output(self):
        result = _score()
        assert "scoring_version" in result

    def test_scoring_version_is_1_0_0(self):
        result = _score()
        assert result["scoring_version"] == "1.0.0"

    def test_scoring_version_matches_constant(self):
        result = _score()
        assert result["scoring_version"] == SCORING_VERSION

    def test_factor_breakdown_has_all_five_keys(self):
        result = _score()
        breakdown = result["factor_breakdown"]
        assert "source_reliability" in breakdown
        assert "organization_association" in breakdown
        assert "contact_verification" in breakdown
        assert "data_freshness" in breakdown
        assert "completeness" in breakdown

    def test_reasons_is_a_list(self):
        result = _score()
        assert isinstance(result["reasons"], list)

    def test_reasons_are_nonempty(self):
        result = _score()
        assert len(result["reasons"]) > 0

    def test_each_reason_has_code_points_desc(self):
        result = _score()
        for reason in result["reasons"]:
            assert "code" in reason
            assert "points" in reason
            assert "desc" in reason

    def test_band_is_valid_value(self):
        for src in ("official_careers", "verified_portal", "aggregator"):
            result = _score(source_type=src)
            assert result["band"] in ("high", "medium", "low", "suppressed")


class TestScoreBounds:
    def test_total_score_never_exceeds_100(self):
        result = _score()
        assert result["score"] <= 100

    def test_total_score_never_below_0(self):
        result = _score(
            source_type="aggregator",
            has_contact_role=False,
            verification_status="undeliverable",
            published_days_ago=None,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        assert result["score"] >= 0

    def test_all_factor_scores_nonnegative(self):
        result = _score(
            source_type="unknown",
            has_contact_role=False,
            verification_status=None,
            published_days_ago=-100,
            has_description=False,
            has_salary=False,
            has_location=False,
        )
        for key, value in result["factor_breakdown"].items():
            assert value >= 0, f"{key} was negative: {value}"

    def test_factor_breakdown_sums_to_total_score(self):
        result = _score(
            source_type="verified_portal",
            has_contact_role=True,
            verification_status="catch_all",
            published_days_ago=5,
            has_description=True,
            has_salary=False,
            has_location=True,
        )
        breakdown_sum = sum(result["factor_breakdown"].values())
        assert breakdown_sum == result["score"]


class TestPersistDataQualityScore:
    def test_persist_calls_insert_once(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        mock_cur.execute.assert_called_once()

    def test_persist_stores_correct_score(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert params[1] == result["score"]

    def test_persist_stores_correct_band(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert params[2] == result["band"]

    def test_persist_stores_scoring_version_1_0_0(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert params[5] == "1.0.0"

    def test_persist_stores_opportunity_id(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        opp_id = "aabbccdd-1234-5678-abcd-000000000001"
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(opp_id, result)
        params = mock_cur.execute.call_args[0][1]
        assert params[0] == opp_id

    def test_persist_stores_suppressed_band(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score(is_suppressed=True)
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert params[2] == "suppressed"

    def test_persist_propagates_db_exception(self):
        mock_transaction = MagicMock()
        mock_transaction.return_value.__enter__ = MagicMock(side_effect=RuntimeError("db down"))
        mock_transaction.return_value.__exit__ = MagicMock(return_value=False)
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            with pytest.raises(RuntimeError, match="db down"):
                persist_data_quality_score(_VALID_OPP_ID, result)

    def test_persist_propagates_execute_failure(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        mock_cur.execute.side_effect = RuntimeError("execute failed")
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            with pytest.raises(RuntimeError, match="execute failed"):
                persist_data_quality_score(_VALID_OPP_ID, result)

    def test_persist_raises_on_empty_opportunity_id(self):
        with pytest.raises(ValueError):
            persist_data_quality_score("", _score())

    def test_persist_raises_on_none_opportunity_id(self):
        with pytest.raises(ValueError):
            persist_data_quality_score(None, _score())

    def test_persist_insert_sql_targets_correct_table(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        sql = mock_cur.execute.call_args[0][0]
        assert "data_quality_scores" in sql

    def test_persist_insert_sql_includes_scoring_version_column(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        sql = mock_cur.execute.call_args[0][0]
        assert "scoring_version" in sql

    def test_persist_reasons_wrapped_in_jsonb(self):
        from psycopg.types.json import Jsonb
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert isinstance(params[3], Jsonb)

    def test_persist_factor_breakdown_wrapped_in_jsonb(self):
        from psycopg.types.json import Jsonb
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            result = _score()
            persist_data_quality_score(_VALID_OPP_ID, result)
        params = mock_cur.execute.call_args[0][1]
        assert isinstance(params[4], Jsonb)

    def test_persist_uses_transaction_not_get_conn(self):
        mock_transaction, _ = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            persist_data_quality_score(_VALID_OPP_ID, _score())
        mock_transaction.assert_called_once()


class TestPersistUUIDValidation:
    def test_persist_raises_on_invalid_uuid_format(self):
        with pytest.raises(ValueError):
            persist_data_quality_score("not-a-uuid", _score())

    def test_persist_raises_on_short_string(self):
        with pytest.raises(ValueError):
            persist_data_quality_score("12345", _score())

    def test_persist_accepts_valid_uuid_string(self):
        mock_transaction, mock_cur = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            persist_data_quality_score(_VALID_OPP_ID, _score())
        mock_cur.execute.assert_called_once()

    def test_persist_raises_on_empty_string(self):
        with pytest.raises(ValueError):
            persist_data_quality_score("", _score())

    def test_persist_raises_on_none_id(self):
        with pytest.raises((ValueError, TypeError)):
            persist_data_quality_score(None, _score())


class TestPersistPayloadValidation:
    def _valid_result(self):
        return _score()

    def test_persist_raises_on_non_dict_result(self):
        mock_transaction, _ = _make_mock_transaction()
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises((TypeError, ValueError)):
                persist_data_quality_score(_VALID_OPP_ID, [1, 2, 3])
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_score_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["score"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_band_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["band"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_scoring_version_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["scoring_version"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_reasons_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["reasons"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_factor_breakdown_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["factor_breakdown"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_score_out_of_range_high(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["score"] = 101
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_score_out_of_range_low(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["score"] = -1
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_score_bool_type(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["score"] = True
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises((TypeError, ValueError)):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_score_non_int(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["score"] = "80"
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises((TypeError, ValueError)):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_invalid_band(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["band"] = "excellent"
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_wrong_scoring_version(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["scoring_version"] = "2.0.0"
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_reasons_not_a_list(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["reasons"] = {}
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_reason_missing_code(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["reasons"] = [{"points": 10, "desc": "something"}]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_missing_breakdown_factor_key(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        del result["factor_breakdown"]["completeness"]
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_factor_exceeding_max(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["factor_breakdown"]["source_reliability"] = 26
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()

    def test_persist_raises_on_factor_negative(self):
        mock_transaction, _ = _make_mock_transaction()
        result = self._valid_result()
        result["factor_breakdown"]["source_reliability"] = -1
        with patch("backend.app.services.scoring_service.transaction", mock_transaction):
            with pytest.raises(ValueError):
                persist_data_quality_score(_VALID_OPP_ID, result)
        mock_transaction.assert_not_called()
