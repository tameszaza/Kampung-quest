import { Icon } from "@/components/icons";

export function ActivityErrorBanner({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="activity-error-banner" role="alert">
    <span className="activity-error-icon" aria-hidden="true"><Icon name="shield" size={19} /></span>
    <div className="activity-error-copy">
      <strong>Activities couldn’t be refreshed</strong>
      <p>{friendlyActivityError(error)}</p>
    </div>
    <button type="button" className="secondary-button" onClick={onRetry}>Try again</button>
  </div>;
}

export function friendlyActivityError(error: string) {
  if (/networkerror|failed to fetch|fetch resource/i.test(error)) return "Check your connection and try again.";
  return "We couldn’t load your activities right now. Please try again.";
}
