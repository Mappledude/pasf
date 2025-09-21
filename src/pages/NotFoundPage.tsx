import React from "react";
import { Link } from "react-router-dom";

const NotFoundPage = () => {
  return (
    <section className="card" style={{ textAlign: "center" }}>
      <h1>Signal Lost</h1>
      <p>We couldn't find that route. Return to the lobby to rejoin the squad.</p>
      <div className="button-row" style={{ justifyContent: "center" }}>
        <Link to="/" className="button">
          Back to Lobby
        </Link>
      </div>
    </section>
  );
};

export default NotFoundPage;
