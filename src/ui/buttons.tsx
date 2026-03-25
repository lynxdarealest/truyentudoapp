import React from "react";
import clsx from "clsx";

type Variant = "primary" | "ghost" | "danger" | "default";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  className?: string;
};

const base = "tf-btn";
const map: Record<Variant, string> = {
  primary: "tf-btn-primary",
  ghost: "tf-btn-ghost",
  danger: "tf-btn-danger",
  default: "tf-btn-ghost",
};

export const TFButton: React.FC<ButtonProps> = ({ variant = "default", className, ...rest }) => (
  <button className={clsx(base, map[variant], className)} {...rest} />
);
