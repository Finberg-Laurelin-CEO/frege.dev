import type { Metadata } from "next";
import PrototypeConsole from "./PrototypeConsole";

export const metadata: Metadata = {
  title: "Frege Prototype Console",
  description: "A local Frege prototype console for permission-aware agent memory.",
};

export default function PrototypePage() {
  return <PrototypeConsole />;
}
