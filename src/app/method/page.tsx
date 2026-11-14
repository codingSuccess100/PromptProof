import type { Metadata } from "next";
import { Method, Nav } from "@/components/Chrome";
import WaveField from "@/components/WaveField";

export const metadata: Metadata = { title: "Method and privacy" };

export default function MethodPage() {
  return (
    <>
      <WaveField calm />
      <Nav />
      <main>
        <Method />
      </main>
    </>
  );
}
