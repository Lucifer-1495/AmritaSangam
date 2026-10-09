export default function PortalBrand({ className = '' }) {
  return (
    <div className={`portal-brand ${className}`.trim()} aria-label="my AMRITA">
      <span className="portal-brand-my">my</span>
      <span className="portal-brand-amrita">AMRITA</span>
    </div>
  );
}
