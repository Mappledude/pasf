export default function CanaryBadge() {
  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        padding: "6px 8px",
        border: "1px dashed #ff0000",
        background: "rgba(255,0,0,0.07)",
        fontSize: 10,
      }}
    >
      RED CANARY ACTIVE
    </div>
  );
}
