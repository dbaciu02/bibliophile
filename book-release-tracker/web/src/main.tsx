import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { createUserManager } from "./auth/userManager";
import { readConfig } from "./env";

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

const config = readConfig();

createRoot(root).render(
  <StrictMode>
    {config.ok ? (
      <AuthProvider manager={createUserManager(config.config)}>
        <App />
      </AuthProvider>
    ) : (
      <main>
        <h1>Configuration missing</h1>
        <p>
          Set these in <code>web/.env</code> (see <code>.env.example</code>) and restart <code>npm run dev:web</code>:
        </p>
        <ul>
          {config.missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
      </main>
    )}
  </StrictMode>,
);
