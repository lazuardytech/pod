"use client";
import PropTypes from "prop-types";
import { useState } from "react";

export default function ProviderIcon({
  src,
  alt,
  size = 32,
  className = "",
  fallbackText = "?",
  fallbackColor,
  ...rest
}: {
  src?: any;
  alt?: any;
  size?: number;
  className?: any;
  fallbackText?: any;
  fallbackColor?: any;
  [key: string]: any;
}) {
  const [errored, setErrored] = useState(false);

  if (!src || errored) {
    return (
      <span
        className={`inline-flex items-center justify-center font-bold rounded-lg ${className}`.trim()}
        style={{
          width: size,
          height: size,
          color: fallbackColor,
          fontSize: Math.max(10, Math.floor(size * 0.38)),
        }}
      >
        {fallbackText}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      onError={() => setErrored(true)}
    />
  );
}

ProviderIcon.propTypes = {
  src: PropTypes.string,
  alt: PropTypes.string,
  size: PropTypes.number,
  className: PropTypes.string,
  fallbackText: PropTypes.string,
  fallbackColor: PropTypes.string,
};
