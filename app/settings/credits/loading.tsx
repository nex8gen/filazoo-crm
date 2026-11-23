import "./credits.css";

export default function CreditsLoading() {
  return <div className="settings-content billing-overview" role="status" aria-label="Loading plan and usage" aria-busy="true">
    <div className="billing-heading"><h2>Plan & usage</h2></div>
    <div className="billing-summary-grid" aria-hidden="true"><div className="billing-card billing-loading-card" /><div className="billing-card billing-loading-card" /></div>
    <div className="billing-resource-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="billing-card billing-loading-resource" />)}</div>
  </div>;
}
