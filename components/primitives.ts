import { tv } from "tailwind-variants";

export const title = tv({
  base: "tracking-tight inline font-semibold",
  variants: {
    color: {
      black: "from-[#3C3D37] to-[#181C14]",
      violet: "from-[#FF1CF7] to-[#b249f8]",
      yellow: "from-[#FF705B] to-[#FFB457]",
      blue: "from-[#5EA2EF] to-[#0072F5]",
      cyan: "from-[#00b7fa] to-[#01cfea]",
      green: "from-[#6FEE8D] to-[#17c964]",
      pink: "from-[#FF72E1] to-[#F54C7A]",
      foreground: "dark:from-[#4B4B4B] dark:to-[#4B4B4B]",
    },
    size: {
      xxs: "text-[0.3rem] lg:text-[1rem] leading-9",
      xs: "text-2xl lg:text-3xl",
      sm: "text-[13px] lg:text-4xl",
      smd: "text-[20px] lg:text-[32px]", // sm과 md 사이의 새로운 크기
      md: "text-[2.3rem] lg:text-5xl leading-9",
      lg: "text-4xl lg:text-6xl",
    },
    fullWidth: {
      true: "w-full block",
    },
    weight: {
      light: "tracking-tight inline font-light",
      normal: "tracking-tight inline font-normal",
      semidbold: "tracking-tight inline font-semibold",
      bold: "tracking-tight inline font-bold",
    },
    position: {
      left: "text-left",
      center: "text-center",
      right: "text-right",
    },
  },
  defaultVariants: {
    size: "md",
  },
  compoundVariants: [
    {
      color: [
        "violet",
        "yellow",
        "blue",
        "cyan",
        "green",
        "pink",
        "foreground",
      ],
      class: "bg-clip-text text-transparent bg-gradient-to-b",
    },
  ],
});

export const subtitle = tv({
  base: "w-full md:w-1/2 my-2 text-lg lg:text-xl text-default-600 block max-w-full",
  variants: {
    fullWidth: {
      true: "!w-full",
    },
  },
  defaultVariants: {
    fullWidth: true,
  },
});

export const TagCustom = tv({
  base: "px-2 py-1 mr-2 bg-sky-200 dark:bg-sky-700 rounded-md",
  variants: {
    color: {
      default: "bg-[#737373] dark:bg-[#737373]",
      violet: "bg-[#FF1CF7] dark:bg-[#b249f8]",
      yellow: "bg-[#FF705B] dark:bg-[#FFB457]",
      blue: "bg-[#5EA2EF] dark:bg-[#0072F5]",
      cyan: "bg-[#00b7fa] dark:bg-[#01cfea]",
      orange: "bg-[#f97316] dark:bg-[#ea580c]",
      brown: "bg-[#92400e] dark:bg-[#92400e]",
      green: "bg-[#6FEE8D] dark:bg-[#17c964]",
      pink: "bg-[#FF72E1] dark:bg-[#F54C7A]",
      foreground: "dark:from-[#FFFFFF] dark:to-[#4B4B4B]",
    },

    compoundVariants: [
      {
        color: [
          "violet",
          "yellow",
          "orange",
          "brown",
          "blue",
          "cyan",
          "green",
          "pink",
          "foreground",
        ],
        class: "bg-clip-text text-transparent bg-gradient-to-b",
      },
    ],
  },
});

export const ButtnCustom = tv({
  base: "px-2 py-1 mr-2 bg-slate-400 dark:bg-slate-700 rounded-md",
});
