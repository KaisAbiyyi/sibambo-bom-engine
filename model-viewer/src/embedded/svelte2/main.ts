import App from "./BoardApp.svelte";
import { mount } from "svelte";
import "./styles/globals.css";
import "./styles/three-stage.css";
import "./styles/scenes.css";
import "./styles/model-loader.css";

const app = mount(App, {
  target: document.getElementById("app")!
});

export default app;
