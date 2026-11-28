import "./credits.css";

export default function CreditsLoading() {
  return <div className="settings-content billing-overview" role="status" aria-label="Loading plan and usage" aria-busy="true">
    <div className="billing-heading"><h1>Plan & usage</h1></div>
    {Array.from({ length: 3 }, (_, i) => <div key={i} className="settings-form-row" aria-hidden="true"><div className="billing-loading-label" /><div className="billing-card billing-loading-card" /></div>)}
    <div className="settings-form-row" aria-hidden="true"><div className="settings-row-heading"><h2>Workspace usage</h2></div><div className="billing-card billing-usage-section"><div className="billing-resource-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="billing-loading-resource" />)}</div></div></div>
  </div>;
}
