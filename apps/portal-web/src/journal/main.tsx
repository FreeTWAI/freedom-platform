import {StrictMode} from "react";
import {createRoot} from "react-dom/client";
import {Editor} from "./Editor.js";
import {App} from "./App.js";
createRoot(document.getElementById("journal-root")!).render(<StrictMode>{location.pathname==='/journal/manage'?<Editor/>:<App/>}</StrictMode>);
