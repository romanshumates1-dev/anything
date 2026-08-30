import { permanentRedirect } from "next/navigation";

// Superseded by the /trust Compliance Center (Phase 1). The old standalone
// page duplicated /trust and carried unsubstantiated SOC 2 / "carrier-grade
// 10DLC" / A2P claims we do not hold pre-registration (bug #31).
export default function CompliancePage() {
  permanentRedirect("/trust");
}
