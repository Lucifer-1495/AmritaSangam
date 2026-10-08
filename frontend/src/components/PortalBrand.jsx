import { Sparkles } from 'lucide-react';

export default function PortalBrand({ className = '' }) {
  return (
    <div className={className}>
      <span className="brand-mark"><Sparkles size={19} /></span>
      CampusSphere
    </div>
  );
}
