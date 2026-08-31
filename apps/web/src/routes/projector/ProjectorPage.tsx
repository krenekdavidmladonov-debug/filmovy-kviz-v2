import { SurfacePlaceholder } from '../../ui/SurfacePlaceholder';

export function ProjectorPage() {
  return (
    <SurfacePlaceholder
      eyebrow="Veřejná projekce"
      title="Projektor čeká na spuštění kvízu"
      description="Projektor bude číst pouze sanitizovaný veřejný stav. Správná odpověď se sem dostane až po serverově autorizovaném odhalení."
      status="Kvíz není aktivní"
      projector
    />
  );
}
