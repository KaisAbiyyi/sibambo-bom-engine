import type { FocusBeat } from "../types";

export const FOCUS_BEATS: FocusBeat[] = [
  {
    id: "origin",
    macro: "",
    eyebrow: "00 / blackbox intake",
    title: "Full structure first. No dashboard noise.",
    body: "Model enters as a product-film subject. The interface stays quiet until a component needs evidence.",
    camera: "hero"
  },
  {
    id: "roof",
    macro: "roof",
    layerKey: "atap_spandek",
    eyebrow: "01 / roof lock",
    title: "Roof ridge isolated in copper light.",
    body: "The camera locks to Atap Spandek. Everything else falls back so pitch, edge, and roof mass read as one shot.",
    camera: "roof"
  },
  {
    id: "openings",
    macro: "openings",
    layerKey: "door",
    eyebrow: "02 / opening lock",
    title: "Door component gets the close shot.",
    body: "The route stops drifting and pins the door layer. Cyan contrast marks the human entry point from JSON geometry.",
    camera: "openings"
  },
  {
    id: "walls",
    macro: "walls",
    layerKey: "wall_x_pos",
    eyebrow: "03 / wall lock",
    title: "Side wall plane cut clean.",
    body: "Side camera targets wall_x_pos directly. Adjacent envelope remains as ghost context, not competing subject.",
    camera: "wall"
  },
  {
    id: "floor",
    macro: "floor",
    layerKey: "keramik_lantai",
    eyebrow: "04 / slab lock",
    title: "Floor datum held low and flat.",
    body: "Amber shot sits on Keramik Lantai so the finish layer and datum read without roof or wall clutter.",
    camera: "floor"
  },
  {
    id: "foundation",
    macro: "foundation",
    layerKey: "cerucuk",
    eyebrow: "05 / pile lock",
    title: "Foundation piles become final subject.",
    body: "The camera drops below grade, then locks to Cerucuk. Clay color separates substructure from visible building shell.",
    camera: "foundation"
  },
  {
    id: "release",
    macro: "",
    eyebrow: "06 / handoff",
    title: "Release camera after the cuts.",
    body: "Orbit mode and click-pick remain after the directed sequence explains which components matter.",
    camera: "orbit"
  }
];
