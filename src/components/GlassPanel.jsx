import React from "react";

export function GlassPanel({ as: Component = "section", className = "", children, ...props }) {
  return (
    <Component className={`glass-panel ${className}`.trim()} {...props}>
      {children}
    </Component>
  );
}
