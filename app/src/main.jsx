import { createRoot } from "react-dom/client";
import "../legacy/app.css";
import App from "./App.jsx";
import { adopt } from "./store.js";

adopt();
createRoot(document.getElementById("react-root")).render(<App />);
