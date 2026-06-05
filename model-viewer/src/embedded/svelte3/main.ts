import App from "./CinematicApp.svelte";
import { mount } from "svelte";
import "./styles/cinematic-clean.css";

const app = mount(App, {
  target: document.getElementById("app")!
});

export default app;
