type LayoutNode = { id?: string; type?: string; children?: LayoutNode[]; currentTab?: number; [key: string]: unknown };

/** Remove only the live temporary leaf from a snapshot, never from the workspace. */
export function withoutPreview(layout: Record<string, unknown>, previewId: string, sourceId: string): Record<string, unknown> {
  const visit = (node: LayoutNode): LayoutNode | null => {
    if (node.type === 'leaf' && node.id === previewId) return null;
    if (!Array.isArray(node.children)) return { ...node };
    const children = node.children.map(visit).filter((child: LayoutNode | null): child is LayoutNode => child !== null);
    const result: LayoutNode = { ...node, children };
    if (node.type === 'tabs' && typeof node.currentTab === 'number') {
      const selectedId = node.children[node.currentTab]?.id;
      const retainedIndex = children.findIndex((child: LayoutNode) => child.id === selectedId);
      const sourceIndex = children.findIndex((child: LayoutNode) => child.id === sourceId);
      result.currentTab = retainedIndex >= 0 ? retainedIndex : sourceIndex >= 0 ? sourceIndex : Math.max(0, Math.min(node.currentTab, children.length - 1));
    }
    return result;
  };
  const snapshot = { ...layout };
  for (const key of ['main', 'left', 'right', 'floating']) {
    const node = layout[key];
    if (node && typeof node === 'object') snapshot[key] = visit(node as LayoutNode);
  }
  if (snapshot.active === previewId) snapshot.active = sourceId;
  return snapshot;
}
