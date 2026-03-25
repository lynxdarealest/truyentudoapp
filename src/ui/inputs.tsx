import React from "react";
import clsx from "clsx";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TFInput: React.FC<InputProps> = ({ className, ...rest }) => (
  <input className={clsx("tf-input", className)} {...rest} />
);

export const TFTextarea: React.FC<TextareaProps> = ({ className, ...rest }) => (
  <textarea className={clsx("tf-textarea", className)} {...rest} />
);
