import { useViewerStore } from "../viewerStore";

export function MaterialPanel() {
  const materials = useViewerStore((state) => state.materials);
  if (!materials.length) return <div className="empty-panel">Material library kosong untuk export level ini.</div>;

  return (
    <table className="material-table">
      <thead>
        <tr>
          <th>Material</th>
          <th>Reflect</th>
        </tr>
      </thead>
      <tbody>
        {materials.map((material, index) => (
          <tr key={`${material.name}-${index}`}>
            <td>
              <span className="material-swatch" style={{ background: material.color }} />
              {material.name}
            </td>
            <td>{material.reflectance ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
