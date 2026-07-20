import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import LiveConsole from "./components/LiveConsole";

export default function App() {
  return (
    <div className="grain min-h-screen bg-bg-base selection:bg-oxblood selection:text-white">
      <Navbar />
      <main>
        <Hero />
        <LiveConsole />
      </main>
    </div>
  );
}
