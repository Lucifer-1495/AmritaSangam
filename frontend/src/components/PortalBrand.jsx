export default function PortalBrand({ className = '' }) {
  return (
    <a className={`portal-brand ${className}`.trim()} href="/" aria-label="Amrita Sangam home">
      <span className="portal-brand-my">Amrita</span>
      <span className="portal-brand-amrita">Sangam</span>
    </a>
  );
}
