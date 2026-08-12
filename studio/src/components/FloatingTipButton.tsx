export function FloatingTipButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Send a tip" data-testid="button-floating-tip" onClick={onClick} className="floating-tip">
      $
    </button>
  );
}
