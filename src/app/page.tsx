import { About, Hero, Nav } from "@/components/Chrome";
import WaveField from "@/components/WaveField";
import Workbench from "@/components/Workbench";
import XrayStory from "@/components/XrayStory";

export default function Home() {
  return (
    <>
      <WaveField />
      <Nav />
      <main>
        <Hero />
        <XrayStory />
        <Workbench />
        <About />
      </main>
    </>
  );
}
