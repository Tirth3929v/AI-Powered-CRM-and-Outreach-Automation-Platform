import React, { useMemo } from "react";

const providerMetricsAvailable = false;

const campaignData = [
  {
    id: 1,
    campaign: "AI/ML Outreach Campaign",
    sent: 200,
    delivered: 180,
    replied: 35,
    bounced: 20,
    unsubscribed: 8,
  },
  {
    id: 2,
    campaign: "Technology Partnership Campaign",
    sent: 150,
    delivered: 140,
    replied: 25,
    bounced: 10,
    unsubscribed: 5,
  },
];

const eventStream = [
  {
    timestamp: "2026-11-19 10:15",
    domain: "gmail.com",
    eventType: "Delivered",
  },
  {
    timestamp: "2026-11-19 10:45",
    domain: "outlook.com",
    eventType: "Replied",
  },
  {
    timestamp: "2026-11-19 11:10",
    domain: "yahoo.com",
    eventType: "Bounced",
  },
  {
    timestamp: "2026-11-19 11:45",
    domain: "hotmail.com",
    eventType: "Unsubscribed",
  },
];

export default function Outcomes() {
  const summary = useMemo(() => {
    const sent = campaignData.reduce((sum, item) => sum + item.sent, 0);

    const delivered = campaignData.reduce(
      (sum, item) => sum + item.delivered,
      0
    );

    const replied = campaignData.reduce(
      (sum, item) => sum + item.replied,
      0
    );

    const bounced = campaignData.reduce(
      (sum, item) => sum + item.bounced,
      0
    );

    const unsubscribed = campaignData.reduce(
      (sum, item) => sum + item.unsubscribed,
      0
    );

    return {
      sent,
      delivered,
      replied,
      bounced,
      unsubscribed,
    };
  }, []);

  const deliveryRate =
    summary.sent > 0
      ? ((summary.delivered / summary.sent) * 100).toFixed(1)
      : "0.0";

  const replyRate =
    summary.delivered > 0
      ? ((summary.replied / summary.delivered) * 100).toFixed(1)
      : "0.0";

  const bounceRate =
    summary.sent > 0
      ? ((summary.bounced / summary.sent) * 100).toFixed(1)
      : "0.0";

  const unsubscribeRate =
    summary.sent > 0
      ? ((summary.unsubscribed / summary.sent) * 100).toFixed(1)
      : "0.0";

  const cardStyle = {
    background: "#ffffff",
    border: "1px solid #e5e7eb",
    borderRadius: "12px",
    padding: "20px",
    textAlign: "center",
  };

  return (
    <div
      style={{
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Campaign Outcomes Dashboard</h1>

      <p
        style={{
          color: "#6b7280",
          marginBottom: "24px",
        }}
      >
        Review campaign delivery and engagement outcomes.
      </p>

      {!providerMetricsAvailable && (
        <div
          style={{
            marginBottom: "24px",
            padding: "16px",
            background: "#fff7ed",
            border: "1px solid #fdba74",
            borderRadius: "8px",
            color: "#9a3412",
            fontWeight: 600,
          }}
        >
          Metrics pending — provider data unavailable.
        </div>
      )}

      {/* Summary Cards */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))",
          gap: "16px",
          marginBottom: "24px",
        }}
      >
        <div style={cardStyle}>
          <h3>Total Sent</h3>
          <h2>{providerMetricsAvailable ? summary.sent : "--"}</h2>
        </div>

        <div style={cardStyle}>
          <h3>Delivered</h3>
          <h2>{providerMetricsAvailable ? summary.delivered : "--"}
          </h2>
        </div>

        <div style={cardStyle}>
          <h3>Replied</h3>
          <h2 >
            {providerMetricsAvailable ? summary.replied : "--"}
          </h2>
        </div>

        <div style={cardStyle}>
          <h3>Bounced</h3>
          <h2>
            {providerMetricsAvailable ? summary.bounced : "--"}
          </h2>
        </div>

        <div style={cardStyle}>
          <h3>Unsubscribed</h3>
          <h2 >
            {providerMetricsAvailable ? summary.unsubscribed : "--"}
          </h2>
        </div>
      </div>

      {/* Metrics */}

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "24px",
        }}
      >
        <h2>Campaign Performance Metrics</h2>

        {providerMetricsAvailable ? (
          <>
            <p>
              <strong>Delivery Rate:</strong> {deliveryRate}%
            </p>
            <p>
              <strong>Reply Rate:</strong> {replyRate}%
            </p>
            <p>
              <strong>Bounce Rate:</strong> {bounceRate}%
            </p>
            <p>
              <strong>Unsubscribe Rate:</strong> {unsubscribeRate}%
            </p>
          </>
        ) : (
          <>
            <p><strong>Delivery Rate:</strong> --</p>
            <p><strong>Reply Rate:</strong> --</p>
            <p><strong>Bounce Rate:</strong> --</p>
            <p><strong>Unsubscribe Rate:</strong> --</p>
          </>
        )}
      </div>

      {/* Campaign Totals Table */}

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          overflow: "hidden",
          marginBottom: "24px",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr style={{ background: "#f9fafb" }}>
              <th style={{ padding: "12px" }}>Campaign</th>
              <th style={{ padding: "12px" }}>Sent</th>
              <th style={{ padding: "12px" }}>Delivered</th>
              <th style={{ padding: "12px" }}>Replied</th>
              <th style={{ padding: "12px" }}>Bounced</th>
              <th style={{ padding: "12px" }}>Unsubscribed</th>
            </tr>
          </thead>

          <tbody>
            {campaignData.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {item.campaign}
                </td>

                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {providerMetricsAvailable ? item.sent : "--"}
                </td>

                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {providerMetricsAvailable ? item.delivered : "--"}
                </td>

                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {providerMetricsAvailable ? item.replied : "--"}
                </td>

                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {providerMetricsAvailable ? item.bounced : "--"}
                </td>

                <td style={{ padding: "12px", borderTop: "1px solid #eee" }}>
                  {providerMetricsAvailable ? item.unsubscribed : "--"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Event Stream */}

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5e7eb",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px" }}>
          <h2>Event Stream</h2>
        </div>

        {providerMetricsAvailable ? (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={{ padding: "12px" }}>Timestamp</th>
                <th style={{ padding: "12px" }}>Recipient Domain</th>
                <th style={{ padding: "12px" }}>Event Type</th>
              </tr>
            </thead>

            <tbody>
              {eventStream.map((event, index) => (
                <tr key={index}>
                  <td
                    style={{
                      padding: "12px",
                      borderTop: "1px solid #eee",
                    }}
                  >
                    {event.timestamp}
                  </td>

                  <td
                    style={{
                      padding: "12px",
                      borderTop: "1px solid #eee",
                    }}
                  >
                    {event.domain}
                  </td>

                  <td
                    style={{
                      padding: "12px",
                      borderTop: "1px solid #eee",
                    }}
                  >
                    {event.eventType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div
            style={{
              padding: "20px",
              color: "#6b7280",
            }}
          >
            Provider event data unavailable.
          </div>
        )}
      </div>
    </div>
  );
}