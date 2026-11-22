

import React, { useMemo, useState } from "react";

const campaigns = [
  { id: "camp-1", name: "AI/ML Outreach Campaign" },
  { id: "camp-2", name: "Technology Partnership Campaign" },
];

// Temporary sample data
const sampleLeads = [
  {
    id: 1,
    name: "Ananya Sharma",
    email: "ananya@example.com",
    organization: "Tech Solutions",
    opportunity: "AI Platform Partnership",
    score: 95,
    deliverability: "Valid",
    suppressed: false,
  },
  {
    id: 2,
    name: "Rahul Verma",
    email: "rahul@example.com",
    organization: "Cloud Innovations",
    opportunity: "Cloud AI Integration",
    score: 88,
    deliverability: "Valid",
    suppressed: false,
  },
  {
    id: 3,
    name: "Priya Reddy",
    email: "priya@example.com",
    organization: "Digital Systems",
    opportunity: "Automation Solutions",
    score: 92,
    deliverability: "Suppressed",
    suppressed: true,
    suppressionReason: "Email address suppressed",
  },
  {
    id: 4,
    name: "Arjun Mehta",
    email: "arjun@example.com",
    organization: "Innovation Labs",
    opportunity: "AI Research Collaboration",
    score: 75,
    deliverability: "Valid",
    suppressed: false,
  },
];

export default function Audience() {
  const [selectedCampaign, setSelectedCampaign] = useState("camp-1");
  const [selectedLeads, setSelectedLeads] = useState([]);

  // Only leads scoring 80 or above appear in the audience.
  const eligibleLeads = useMemo(
    () => sampleLeads.filter((lead) => lead.score >= 80),
    []
  );

  const selectableLeads = eligibleLeads.filter(
    (lead) => !lead.suppressed
  );

  const toggleLead = (lead) => {
    if (lead.suppressed || lead.score < 80) return;

    setSelectedLeads((previous) =>
      previous.includes(lead.id)
        ? previous.filter((id) => id !== lead.id)
        : [...previous, lead.id]
    );
  };

  const toggleAll = () => {
    const allSelected =
      selectableLeads.length > 0 &&
      selectableLeads.every((lead) =>
        selectedLeads.includes(lead.id)
      );

    setSelectedLeads(
      allSelected
        ? []
        : selectableLeads.map((lead) => lead.id)
    );
  };

  const styles = {
    container: {
      padding: "24px",
      fontFamily: "Arial, sans-serif",
      color: "#1f2937",
    },
    heading: {
      fontSize: "24px",
      fontWeight: 700,
      marginBottom: "8px",
    },
    subtitle: {
      color: "#6b7280",
      marginBottom: "24px",
    },
    select: {
      padding: "10px 14px",
      border: "1px solid #d1d5db",
      borderRadius: "8px",
      minWidth: "260px",
      background: "#fff",
      marginBottom: "20px",
    },
    counter: {
      padding: "14px 18px",
      background: "#eff6ff",
      color: "#1d4ed8",
      borderRadius: "8px",
      fontWeight: 600,
      marginBottom: "20px",
    },
    tableWrapper: {
      overflowX: "auto",
      border: "1px solid #e5e7eb",
      borderRadius: "10px",
    },
    table: {
      width: "100%",
      borderCollapse: "collapse",
      textAlign: "left",
    },
    th: {
      padding: "14px",
      background: "#f9fafb",
      borderBottom: "1px solid #e5e7eb",
      fontSize: "13px",
      color: "#6b7280",
    },
    td: {
      padding: "14px",
      borderBottom: "1px solid #e5e7eb",
      fontSize: "14px",
    },
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>Campaign Audience</h1>

      <p style={styles.subtitle}>
        Review and select qualified leads for outreach campaigns.
      </p>

      <label htmlFor="campaign-select">
        <strong>Select Campaign</strong>
      </label>
      <br />

      <select
        id="campaign-select"
        value={selectedCampaign}
        onChange={(event) => {
          setSelectedCampaign(event.target.value);
          setSelectedLeads([]);
        }}
        style={styles.select}
      >
        {campaigns.map((campaign) => (
          <option key={campaign.id} value={campaign.id}>
            {campaign.name}
          </option>
        ))}
      </select>

      <div style={styles.counter} aria-live="polite">
        {selectedLeads.length} leads selected for outreach
      </div>

      <div style={styles.tableWrapper}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>
                <input
                  type="checkbox"
                  aria-label="Select all eligible leads"
                  checked={
                    selectableLeads.length > 0 &&
                    selectableLeads.every((lead) =>
                      selectedLeads.includes(lead.id)
                    )
                  }
                  onChange={toggleAll}
                />
              </th>
              <th style={styles.th}>Recipient</th>
              <th style={styles.th}>Email</th>
              <th style={styles.th}>Deliverability</th>
              <th style={styles.th}>Organization</th>
              <th style={styles.th}>Opportunity</th>
              <th style={styles.th}>Score</th>
            </tr>
          </thead>

          <tbody>
            {eligibleLeads.map((lead) => {
              const isSuppressed = lead.suppressed;
              const isSelected = selectedLeads.includes(lead.id);

              return (
                <tr
                  key={lead.id}
                  style={{
                    background: isSuppressed
                      ? "#f3f4f6"
                      : isSelected
                      ? "#eff6ff"
                      : "#fff",
                    color: isSuppressed
                      ? "#9ca3af"
                      : "#1f2937",
                  }}
                >
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={isSuppressed}
                      aria-label={`Select ${lead.name}`}
                      onChange={() => toggleLead(lead)}
                    />
                  </td>

                  <td style={styles.td}>{lead.name}</td>
                  <td style={styles.td}>{lead.email}</td>

                  <td style={styles.td}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "4px 9px",
                        borderRadius: "12px",
                        fontSize: "12px",
                        fontWeight: 600,
                        background: isSuppressed
                          ? "#e5e7eb"
                          : "#dcfce7",
                        color: isSuppressed
                          ? "#6b7280"
                          : "#166534",
                      }}
                    >
                      {lead.deliverability}
                    </span>

                    {isSuppressed && (
                      <span
                        style={{
                          display: "inline-block",
                          marginTop: "5px",
                          padding: "4px 8px",
                          borderRadius: "6px",
                          background: "#e5e7eb",
                          color: "#6b7280",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        {lead.suppressionReason || "Suppressed"}
                      </span>
                    )}
                  </td>

                  <td style={styles.td}>{lead.organization}</td>
                  <td style={styles.td}>{lead.opportunity}</td>
                  <td style={styles.td}>{lead.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
