import type { TreeNode } from "../types";
import { useViewerStore } from "../viewerStore";

interface TreePanelProps {
  onFocusNode: (id: string) => void;
}

export function TreePanel({ onFocusNode }: TreePanelProps) {
  const tree = useViewerStore((state) => state.tree);
  if (!tree.length) return <div className="empty-panel">Hierarchy akan muncul setelah model dimuat.</div>;
  return (
    <div className="tree-panel">
      {tree.map((node) => (
        <TreeItem key={node.id} node={node} onFocusNode={onFocusNode} depth={0} />
      ))}
    </div>
  );
}

function TreeItem({ node, onFocusNode, depth }: { node: TreeNode; onFocusNode: (id: string) => void; depth: number }) {
  return (
    <div className="tree-item">
      <button className="tree-row" style={{ paddingLeft: 8 + depth * 14 }} type="button" onClick={() => onFocusNode(node.id)}>
        <span className="tree-type">{node.type.slice(0, 1)}</span>
        <span className="tree-name">{node.name}</span>
        {node.faceCount ? <span className="tree-count">{node.faceCount}</span> : null}
      </button>
      {node.children.map((child) => (
        <TreeItem key={child.id} node={child} onFocusNode={onFocusNode} depth={depth + 1} />
      ))}
    </div>
  );
}
