interface LoadingOverlayProps {
  loading: boolean;
  error?: string | null;
  label?: string;
  subtitle?: string;
  progress?: number | null;
}

export function LoadingOverlay({
  loading,
  error,
  label = "Memuat model",
  subtitle = "Menyiapkan geometri 3D dan layer.",
  progress = null
}: LoadingOverlayProps) {
  if (!loading && !error) return null;

  return (
    <div className="loading-overlay">
      {loading ? <div className="spinner" /> : null}
      <div className="loading-title">{error ? "Gagal memuat model" : label}</div>
      {error ? (
        <div className="loading-error">{error}</div>
      ) : (
        <>
          <div className="loading-subtitle">{subtitle}</div>
          {progress !== null ? (
            <div className="loading-progress" aria-label={`Progress ${progress}%`}>
              <span style={{ width: `${progress}%` }} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
