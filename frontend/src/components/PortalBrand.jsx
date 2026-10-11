export default function PortalBrand({ className = '' }) {
  return (
    <div className={`portal-brand ${className}`.trim()} aria-label="Amrita Sangam">
      <span className="portal-brand-my">Amrita</span>
      <span className="portal-brand-amrita">Sangam</span>
    </div>
  );
}
