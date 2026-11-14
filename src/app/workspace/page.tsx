import type { Metadata } from "next";
import { Nav } from "@/components/Chrome";
import WaveField from "@/components/WaveField";
import Workbench from "@/components/Workbench";

export const metadata: Metadata = { title: "Workspace" };

export default function WorkspacePage() {
  return (
    <>
      <WaveField calm />
      <Nav />
      <main>
        <Workbench />
      </main>
    </>
  );
}
