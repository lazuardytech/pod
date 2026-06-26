"use client";
import React from "react";
import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/shared/hooks/useTheme";
import LucideIcon from "@/shared/components/LucideIcon";

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon?: any;
  label?: any;
  onClick?: any;
  danger?: any;
  [key: string]: any;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 text-[13px] tracking-[-0.12px] transition-colors duration-100 ${
        danger ? "text-warning-red hover:bg-warning-red/8" : "text-storm-cloud hover:bg-deep-slate hover:text-porcelain"
      }`}
    >
      <LucideIcon name={icon} className="text-[15px]" />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }: { onLogout?: any; [key: string]: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const handleClickOutside = (e: any) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen((v: any) => !v)}
        className="flex items-center justify-center size-7 rounded-[4px] text-storm-cloud hover:bg-deep-slate hover:text-porcelain transition-colors duration-100"
        title="Menu"
      >
        <LucideIcon name="more_horiz" className="text-[16px]" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-graphite border border-charcoal-grey rounded-[6px] shadow-[var(--shadow-xl)] z-50 fade-in overflow-hidden py-1">
          <MenuItem
            icon={isDark ? "light_mode" : "dark_mode"}
            label={isDark ? "Toggle Light Theme" : "Toggle Dark Theme"}
            onClick={() => {
              toggleTheme();
              close();
            }}
          />
          <div className="my-1 border-t border-charcoal-grey" />
          <MenuItem
            icon="logout"
            label="Logout"
            danger
            onClick={() => {
              close();
              onLogout();
            }}
          />
        </div>
      )}
    </div>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
