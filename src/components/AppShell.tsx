import React from "react";
import { NavLink, Outlet } from "react-router-dom";

import BuildBadge from "./BuildBadge";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "active" : undefined;

const AppShell = () => {
  return (
    <div className="app halftone">
      <header className="header">
        <nav className="nav">
          <strong style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.04em" }}>PASf</strong>
          <NavLink to="/" end className={navLinkClass}>
            Lobby
          </NavLink>
          <NavLink to="/admin" className={navLinkClass}>
            Admin
          </NavLink>
          <NavLink to="/training" className={navLinkClass}>
            Training
          </NavLink>
        </nav>
      </header>
      <main className="main" style={{ maxWidth: 1100, margin: "24px auto", padding: "0 16px" }}>
        <Outlet />
      </main>
      <footer className="footer">
        <span className="muted">stickfightpa · Firestore · Anonymous auth</span>
      </footer>
      <BuildBadge />
    </div>
  );
};

export default AppShell;
