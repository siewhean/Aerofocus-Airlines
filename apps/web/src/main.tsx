import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import "./styles/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");

// Enable the theme crossfade one frame after the first paint (see global.css).
requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("is-ready")));

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
