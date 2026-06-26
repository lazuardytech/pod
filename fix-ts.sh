#!/bin/bash
# Fix remaining TS7053 errors by adding Record<string, any> to style map declarations
# and fixing patterns where known-key objects are accessed with string keys

cd /Users/ezra/projects/lt/pod

# Style map objects: const sizes = { ... }
# Add : Record<string, any> type annotation
fix_const_map() {
  local file="$1"
  local var="$2"
  sed -i '' "s/^const $var = {/const $var: Record<string, any> = {/" "$file"
}

fix_const_map "src/shared/components/Avatar.tsx" "sizes"
fix_const_map "src/shared/components/Badge.tsx" "sizes"
fix_const_map "src/shared/components/Badge.tsx" "dotColors"
fix_const_map "src/shared/components/Button.tsx" "sizes"
fix_const_map "src/shared/components/Button.tsx" "variants"
fix_const_map "src/shared/components/Card.tsx" "paddings"
fix_const_map "src/shared/components/Drawer.tsx" "widths"
fix_const_map "src/shared/components/Loading.tsx" "sizes"
fix_const_map "src/shared/components/Modal.tsx" "widths"
fix_const_map "src/shared/components/SegmentedControl.tsx" "sizes"
fix_const_map "src/shared/components/Toggle.tsx" "variants"

# For ThemeToggle
sed -i '' 's/^const styles = {/const styles: Record<string, any> = {/' "src/shared/components/ThemeToggle.tsx"

# For LucideIcon - fix ICON_MAP
sed -i '' 's/^const ICON_MAP = {/const ICON_MAP: Record<string, any> = {/' "src/shared/components/LucideIcon.tsx"

# For the "colors" map in MetricsLineChart
sed -i '' 's/^const colors = {/const colors: Record<string, any> = {/' "src/app/(dashboard)/usage/components/MetricsLineChart.tsx"

# For ConsoleLogClient - fix log styles and counts maps
sed -i '' 's/^const LOG_STYLES = {/const LOG_STYLES: Record<string, any> = {/' "src/app/(dashboard)/logs/ConsoleLogClient.tsx"
sed -i '' 's/^const LOG_LABELS = {/const LOG_LABELS: Record<string, any> = {/' "src/app/(dashboard)/logs/ConsoleLogClient.tsx"
sed -i '' 's/^const LOG_ICONS = {/const LOG_ICONS: Record<string, any> = {/' "src/app/(dashboard)/logs/ConsoleLogClient.tsx"

# For ProxyLogsTab - fix tab colors
sed -i '' 's/^const TAB_COLORS = {/const TAB_COLORS: Record<string, any> = {/' "src/app/(dashboard)/logs/ProxyLogsTab.tsx"

# For MediaProviderKindClient - fix service Icons
sed -i '' 's/^const SERVICE_ICONS = {/const SERVICE_ICONS: Record<string, any> = {/' "src/app/(dashboard)/media-providers/\[kind\]/MediaProviderKindClient.tsx"

# For specific objects indexed with [string] in model files
sed -i '' 's/^const MODELS = {/const MODELS: Record<string, any> = {/' "src/shared/constants/models.ts"

# For MediaProviderDetailClient - headers objects that get more keys added
sed -i '' 's/const headers = { "Content-Type": "application\/json" };/const headers: Record<string, any> = { "Content-Type": "application\/json" };/' "src/app/(dashboard)/media-providers/[kind]/[id]/MediaProviderDetailClient.tsx"

# For MediaProviderComboClient similar patterns
sed -i '' 's/const headers = { "Content-Type": "application\/json" };/const headers: Record<string, any> = { "Content-Type": "application\/json" };/' "src/app/(dashboard)/media-providers/combo/[id]/MediaProviderComboClient.tsx"

# For ProvidersClient - tab filter map
sed -i '' 's/^const FILTER_OPTIONS = {/const FILTER_OPTIONS: Record<string, any> = {/' "src/app/(dashboard)/providers/ProvidersClient.tsx"

# For ProviderLimitCard - the map objects
sed -i '' 's/^const PROVIDER_ICONS = {/const PROVIDER_ICONS: Record<string, any> = {/' "src/app/(dashboard)/usage/components/ProviderLimits/ProviderLimitCard.tsx"
sed -i '' 's/^const TIER_NAMES = {/const TIER_NAMES: Record<string, any> = {/' "src/app/(dashboard)/usage/components/ProviderLimits/ProviderLimitCard.tsx"

# For ProviderTopology - the textIcon property
sed -i '' 's/const textIcon: any/const textIcon: any =/' "src/app/(dashboard)/usage/components/ProviderTopology.tsx" 2>/dev/null || true

# Fix ProviderTopology TS7018 - add : any to the return
sed -i '' 's/return {/return { as any/' "src/app/(dashboard)/usage/components/ProviderTopology.tsx"

echo "Done with Record fixes"
