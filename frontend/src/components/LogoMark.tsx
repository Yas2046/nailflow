interface Props {
  className?: string;
}

export default function LogoMark({ className = 'w-6 h-6' }: Props) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2L14.12 9.88L22 12L14.12 14.12L12 22L9.88 14.12L2 12L9.88 9.88L12 2Z" />
    </svg>
  );
}
