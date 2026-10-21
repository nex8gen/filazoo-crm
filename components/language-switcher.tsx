"use client";

import { Check, Languages } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Change language" render={<Button variant="ghost" className="h-8 gap-1.5 px-2 text-muted-foreground" />}>
        <Languages className="size-4" /><span data-no-translate className="hidden text-xs font-medium sm:inline">{language === "en" ? "EN" : "中文"}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup><DropdownMenuLabel>Language</DropdownMenuLabel></DropdownMenuGroup><DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setLanguage("en")}><span className="flex-1">English</span>{language === "en" ? <Check className="size-4" /> : null}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setLanguage("zh-CN")}><span className="flex-1">简体中文</span>{language === "zh-CN" ? <Check className="size-4" /> : null}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
