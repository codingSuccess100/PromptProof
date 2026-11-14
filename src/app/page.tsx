import { Landing, Nav } from "@/components/Chrome";
import WaveField from "@/components/WaveField";

export default function Home() {
  return (
    <>
      <WaveField />
      <Nav />
      <main>
        <Landing />
      </main>
    </>
  );
}
