"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UseAdminActionResult } from "../../hooks/useAdminAction";
import { AdminCard } from "./AdminCard";
import { metadataUriSchema, type MetadataUriData } from "./schemas";

/** Point the token at off-chain metadata JSON (logo, description, links). */
export function MetadataCard({
  admin,
  disabled,
}: {
  admin: UseAdminActionResult;
  disabled: boolean;
}) {
  const form = useForm<MetadataUriData>({
    resolver: zodResolver(metadataUriSchema),
  });

  const onSubmit = async (data: MetadataUriData) => {
    if (await admin.run("metadata-uri", data)) {
      form.reset();
    }
  };

  return (
    <AdminCard
      title="Metadata URI"
      icon={ExternalLink}
      description="Set or update the URI pointing to off-chain token metadata (logo, description, etc.)"
    >
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        className="flex flex-col gap-4"
      >
        <Input
          {...form.register("uri")}
          type="url"
          aria-label="Metadata URI"
          placeholder="https://example.com/token-metadata.json"
          error={form.formState.errors.uri?.message}
          disabled={disabled}
        />
        <Button
          type="submit"
          className="w-full bg-white/5 border-white/10 hover:bg-white/10 text-white"
          disabled={disabled}
          isLoading={admin.loading === "metadata-uri"}
        >
          Update URI
        </Button>
      </form>
    </AdminCard>
  );
}
