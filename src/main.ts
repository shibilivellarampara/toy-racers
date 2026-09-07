import "./style.css";
import { App } from "./ui/screens";

const mount = document.querySelector<HTMLDivElement>("#app")!;
new App(mount);
