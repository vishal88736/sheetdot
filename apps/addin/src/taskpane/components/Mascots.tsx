export function PeekingGreenMascot({ className = "h-16 w-20" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="greenBlob" cx="40%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#B8F068" />
          <stop offset="65%" stopColor="#7AD63B" />
          <stop offset="100%" stopColor="#4CAF2A" />
        </radialGradient>
      </defs>
      {/* Sprout */}
      <ellipse cx="56" cy="18" rx="6" ry="11" transform="rotate(-18 56 18)" fill="#89E048" />
      <ellipse cx="66" cy="19" rx="5" ry="10" transform="rotate(20 66 19)" fill="#75D138" />
      {/* Body */}
      <path
        d="M24 80 C24 38, 36 22, 60 22 C84 22, 96 38, 96 80 Z"
        fill="url(#greenBlob)"
      />
      {/* Eyes */}
      <circle cx="49" cy="49" r="8.5" fill="#13172B" />
      <circle cx="71" cy="49" r="8.5" fill="#13172B" />
      <circle cx="46.5" cy="46" r="3" fill="#FFFFFF" />
      <circle cx="68.5" cy="46" r="3" fill="#FFFFFF" />
      {/* Smile */}
      <path
        d="M54 61 Q60 66 66 61"
        stroke="#13172B"
        strokeWidth="2.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* Little peeking hands */}
      <ellipse cx="26" cy="79" rx="10" ry="6.5" fill="#9EE853" />
      <ellipse cx="94" cy="79" rx="10" ry="6.5" fill="#9EE853" />
    </svg>
  );
}

export function WavingPurpleMascot({ className = "h-32 w-32" }: { className?: string }) {
  return (
    <svg viewBox="0 0 140 130" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="purpleBlob" cx="38%" cy="30%" r="72%">
          <stop offset="0%" stopColor="#9B8CFF" />
          <stop offset="65%" stopColor="#6E5AF6" />
          <stop offset="100%" stopColor="#4F3CD1" />
        </radialGradient>
      </defs>
      {/* Waving hand */}
      <ellipse cx="27" cy="72" rx="12" ry="18" transform="rotate(-24 27 72)" fill="#7E6CF9" />
      {/* Sprout */}
      <ellipse cx="70" cy="20" rx="6" ry="12" transform="rotate(-12 70 20)" fill="#8B7BFF" />
      <ellipse cx="81" cy="22" rx="5" ry="10" transform="rotate(24 81 22)" fill="#7865F7" />
      {/* Body */}
      <path
        d="M32 115 C30 58, 46 30, 74 30 C102 30, 118 58, 116 115 Z"
        fill="url(#purpleBlob)"
      />
      {/* Left big eye */}
      <circle cx="62" cy="64" r="12" fill="#FFFFFF" />
      <circle cx="63.5" cy="64" r="7" fill="#13172B" />
      <circle cx="60.5" cy="61" r="2.6" fill="#FFFFFF" />
      {/* Right winking eye */}
      <path
        d="M84 65 Q91 58 98 65"
        stroke="#13172B"
        strokeWidth="3.5"
        strokeLinecap="round"
        fill="none"
      />
      {/* Happy mouth */}
      <path d="M68 80 Q77 92 86 80 Z" fill="#13172B" />
      <ellipse cx="77" cy="86" rx="4.5" ry="2.4" fill="#FF7EA5" />
      {/* Resting right hand */}
      <ellipse cx="113" cy="105" rx="11" ry="8" fill="#8574FA" />
      {/* Accent spark lines */}
      <path d="M18 46 L12 40 M26 39 L24 31 M34 45 L40 39" stroke="#5A46E0" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function DetailPinkMascot({ className = "h-16 w-20" }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="pinkBlob" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stopColor="#FFAAD0" />
          <stop offset="65%" stopColor="#FF7EB6" />
          <stop offset="100%" stopColor="#EA5898" />
        </radialGradient>
      </defs>
      <ellipse cx="56" cy="16" rx="5.5" ry="10" transform="rotate(-15 56 16)" fill="#FF8EC0" />
      <ellipse cx="66" cy="17" rx="5" ry="9" transform="rotate(20 66 17)" fill="#F76CA9" />
      <path d="M26 78 C26 38, 38 22, 60 22 C82 22, 94 38, 94 78 Z" fill="url(#pinkBlob)" />
      <circle cx="49" cy="48" r="9.5" fill="#FFFFFF" />
      <circle cx="71" cy="48" r="9.5" fill="#FFFFFF" />
      <circle cx="50" cy="48" r="5.5" fill="#13172B" />
      <circle cx="72" cy="48" r="5.5" fill="#13172B" />
      <circle cx="48" cy="45.5" r="2" fill="#FFFFFF" />
      <circle cx="70" cy="45.5" r="2" fill="#FFFFFF" />
      <path
        d="M55 61 Q60 66 65 61"
        stroke="#13172B"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <ellipse cx="29" cy="76" rx="9.5" ry="6" fill="#FF9BC7" />
      <ellipse cx="91" cy="76" rx="9.5" ry="6" fill="#FF9BC7" />
    </svg>
  );
}
