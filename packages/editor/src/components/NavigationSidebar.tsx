'use client';

import { useEditorConfig } from '../runtime';

/** The host app's navigation, when it gives one; the editor has none of its own. */
export default function NavigationSidebar(_props: Record<string, unknown>) {
  const { renderNavigation } = useEditorConfig();
  return renderNavigation ? <>{renderNavigation()}</> : null;
}
