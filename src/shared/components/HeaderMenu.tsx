"use client";
import PropTypes from "prop-types";
import { IconButton } from "@/shared/components";
import LucideIcon from "@/shared/components/LucideIcon";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { useTheme } from "@/shared/hooks/useTheme";

export default function HeaderMenu({ onLogout }: { onLogout?: () => void }) {
  const { isDark, toggleTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton
            icon="more_horiz"
            title="Menu"
            variant="ghost"
            className="text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
          />
        }
      />
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="w-48 bg-graphite border border-charcoal-grey rounded-[6px] shadow-[var(--shadow-xl)] py-1 fade-in"
      >
        <DropdownMenuItem
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] tracking-[-0.12px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain rounded-none"
          onClick={toggleTheme}
        >
          <LucideIcon name={isDark ? "light_mode" : "dark_mode"} className="text-[15px]" />
          <span>{isDark ? "Toggle Light Theme" : "Toggle Dark Theme"}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 border-charcoal-grey bg-charcoal-grey" />
        <DropdownMenuItem
          variant="destructive"
          className="flex items-center gap-2.5 px-3 py-2 text-[13px] tracking-[-0.12px] text-warning-red hover:bg-warning-red/8 hover:text-warning-red rounded-none"
          onClick={() => onLogout?.()}
        >
          <LucideIcon name="logout" className="text-[15px]" />
          <span>Logout</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
