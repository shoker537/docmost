import { useState } from "react";
import {
  Alert,
  Anchor,
  Button,
  Checkbox,
  Group,
  Loader,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import useUserRole from "@/hooks/use-user-role";
import SettingsTitle from "@/components/settings/settings-title";
import { DocumentTitle } from "@/components/ui/document-title";
import CopyTextButton from "@/components/common/copy";
import {
  createApiKey,
  getApiKeys,
  IApiKey,
  renameApiKey,
  revokeApiKey,
  setApiRestriction,
} from "./api-key-service";
import { getWorkspace } from "@/features/workspace/services/workspace-service";

function errorMessage(error: unknown, fallback: string): string {
  const message = (error as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof message === "string"
    ? message
    : Array.isArray(message)
      ? message.join("; ")
      : fallback;
}

export function ApiKeysPage({ adminView = false }: { adminView?: boolean }) {
  const { t } = useTranslation();
  const { isAdmin } = useUserRole();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query] = useDebouncedValue(search, 300);
  const [cursor, setCursor] = useState<string>();
  const [beforeCursor, setBeforeCursor] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiration, setExpiration] = useState<string | null>("30");
  const [customExpiry, setCustomExpiry] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [revoking, setRevoking] = useState<IApiKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const params = { limit: 20, adminView, query, cursor, beforeCursor };
  const keys = useQuery({
    queryKey: ["api-key-list", params],
    queryFn: () => getApiKeys(params),
    enabled: !adminView || isAdmin,
    placeholderData: keepPreviousData,
  });
  const title = adminView ? t("API management") : t("API keys");
  const workspace = useQuery({
    queryKey: ["workspace"],
    queryFn: getWorkspace,
    enabled: adminView && isAdmin,
  });

  if (adminView && !isAdmin)
    return (
      <Alert color="red">
        {t("Only workspace administrators can manage all API keys.")}
      </Alert>
    );

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["api-key-list"] });
  }

  async function restrictApi(value: boolean) {
    setBusy(true);
    setError("");
    try {
      await setApiRestriction(value);
      await queryClient.invalidateQueries({ queryKey: ["workspace"] });
    } catch (err) {
      setError(errorMessage(err, t("Could not update API access")));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    let expiresAt: string | undefined;
    if (expiration !== "never") {
      const date =
        expiration === "custom"
          ? new Date(customExpiry)
          : new Date(Date.now() + Number(expiration) * 86400000);
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setError(t("Expiration must be in the future"));
        return;
      }
      expiresAt = date.toISOString();
    }
    setBusy(true);
    try {
      const result = await createApiKey({ name: name.trim(), expiresAt });
      // Keep credentials out of query/mutation caches, URLs and browser storage.
      setToken(result.token);
      setCreateOpen(false);
      setName("");
      await refresh();
    } catch (err) {
      setError(errorMessage(err, t("Could not create API key")));
    } finally {
      setBusy(false);
    }
  }

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    if (!renaming) return;
    setBusy(true);
    setError("");
    try {
      await renameApiKey(renaming.id, renaming.name.trim());
      await refresh();
      setRenaming(null);
    } catch (err) {
      setError(errorMessage(err, t("Could not rename API key")));
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    setError("");
    try {
      await revokeApiKey(revoking.id);
      await refresh();
      setRevoking(null);
    } catch (err) {
      setError(errorMessage(err, t("Could not revoke API key")));
    } finally {
      setBusy(false);
    }
  }

  const dateLabel = (value: string | null, fallback: string) =>
    value ? new Date(value).toLocaleString() : fallback;
  const errorAlert = error ? (
    <Alert color="red" role="alert">
      {error}
    </Alert>
  ) : null;

  return (
    <Stack>
      <DocumentTitle title={title} />
      <SettingsTitle title={title} />
      <Text c="dimmed">
        {adminView
          ? t("View, rename and revoke API keys across your workspace.")
          : t(
              "API keys inherit your current workspace permissions. Treat them like passwords.",
            )}
      </Text>
      <Anchor
        href="https://docmost.com/api-docs"
        target="_blank"
        rel="noopener noreferrer"
      >
        {t("API reference")}
      </Anchor>
      {adminView && workspace.isError && (
        <Alert color="red">{t("Could not load API access settings")}</Alert>
      )}
      {adminView && workspace.data && (
        <Checkbox
          label={t("Restrict API access to workspace administrators")}
          description={t(
            "Member API keys stop working while this setting is enabled. Members can still revoke their keys.",
          )}
          checked={workspace.data.settings?.api?.restrictToAdmins === true}
          disabled={busy || workspace.isFetching}
          onChange={(event) => {
            void restrictApi(event.currentTarget.checked);
          }}
        />
      )}
      <Group justify="space-between">
        <TextInput
          aria-label={t("Search API keys")}
          placeholder={t("Search API keys")}
          value={search}
          onChange={(event) => {
            setSearch(event.currentTarget.value);
            setCursor(undefined);
            setBeforeCursor(undefined);
          }}
        />
        {!adminView && (
          <Button
            onClick={() => {
              setError("");
              setExpiration("30");
              setCustomExpiry("");
              setName("");
              setCreateOpen(true);
            }}
          >
            {t("Create API Key")}
          </Button>
        )}
      </Group>
      {!createOpen && !renaming && !revoking && errorAlert}
      {keys.isPending ? (
        <Loader aria-label={t("Loading API keys")} />
      ) : keys.isError ? (
        <Alert color="red">
          {errorMessage(keys.error, t("Could not load API keys"))}
        </Alert>
      ) : (
        <ScrollArea>
          <Table miw={700}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Name")}</Table.Th>
                {adminView && <Table.Th>{t("User")}</Table.Th>}
                <Table.Th>{t("Last used")}</Table.Th>
                <Table.Th>{t("Expires")}</Table.Th>
                <Table.Th>{t("Created")}</Table.Th>
                <Table.Th>{t("Actions")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {keys.data?.items.map((key) => (
                <Table.Tr key={key.id}>
                  <Table.Td>{key.name}</Table.Td>
                  {adminView && (
                    <Table.Td>
                      <Text size="sm">{key.creator?.name}</Text>
                      <Text size="xs" c="dimmed">
                        {key.creator?.email}
                      </Text>
                    </Table.Td>
                  )}
                  <Table.Td>{dateLabel(key.lastUsedAt, t("Never"))}</Table.Td>
                  <Table.Td>{dateLabel(key.expiresAt, t("Never"))}</Table.Td>
                  <Table.Td>{dateLabel(key.createdAt, "")}</Table.Td>
                  <Table.Td>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="subtle"
                        disabled={busy}
                        aria-label={t("Rename {{name}}", { name: key.name })}
                        onClick={() => {
                          setError("");
                          setRenaming({ id: key.id, name: key.name });
                        }}
                      >
                        {t("Rename")}
                      </Button>
                      <Button
                        size="xs"
                        variant="subtle"
                        color="red"
                        disabled={busy}
                        aria-label={t("Revoke {{name}}", { name: key.name })}
                        onClick={() => {
                          setError("");
                          setRevoking(key);
                        }}
                      >
                        {t("Revoke")}
                      </Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {keys.data?.items.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={adminView ? 6 : 5}>
                    <Text c="dimmed">{t("No API keys found")}</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea>
      )}
      <Group justify="flex-end">
        <Button
          variant="default"
          disabled={!keys.data?.meta.hasPrevPage || keys.isFetching}
          onClick={() => {
            setCursor(undefined);
            setBeforeCursor(keys.data?.meta.prevCursor ?? undefined);
          }}
        >
          {t("Previous")}
        </Button>
        <Button
          variant="default"
          disabled={!keys.data?.meta.hasNextPage || keys.isFetching}
          onClick={() => {
            setBeforeCursor(undefined);
            setCursor(keys.data?.meta.nextCursor ?? undefined);
          }}
        >
          {t("Next")}
        </Button>
      </Group>
      <Modal
        opened={createOpen}
        onClose={() => {
          if (!busy) setCreateOpen(false);
        }}
        title={t("Create API Key")}
      >
        <form onSubmit={create}>
          <Stack>
            {errorAlert}
            <TextInput
              label={t("Name")}
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            <Select
              label={t("Expiration")}
              value={expiration}
              allowDeselect={false}
              onChange={(value) => {
                if (typeof value === "string") setExpiration(value);
              }}
              data={[
                ...["30", "60", "90", "365"].map((value) => ({
                  value,
                  label: t("{{days}} days", { days: value }),
                })),
                { value: "custom", label: t("Custom") },
                { value: "never", label: t("No expiration") },
              ]}
            />
            {expiration === "custom" && (
              <TextInput
                type="datetime-local"
                label={t("Expiration date")}
                required
                value={customExpiry}
                onChange={(e) => setCustomExpiry(e.currentTarget.value)}
              />
            )}
            <Button type="submit" loading={busy} disabled={!name.trim()}>
              {t("Create")}
            </Button>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={token !== null}
        onClose={() => setToken(null)}
        title={t("Copy your API key")}
      >
        <Stack>
          <Alert>{t("Copy this key now. It will not be shown again.")}</Alert>
          <Textarea
            label={t("API key")}
            value={token ?? ""}
            readOnly
            autosize
            minRows={4}
          />
          <Group justify="space-between">
            <CopyTextButton text={token ?? ""} />
            <Button onClick={() => setToken(null)}>{t("Done")}</Button>
          </Group>
        </Stack>
      </Modal>
      <Modal
        opened={renaming !== null}
        onClose={() => {
          if (!busy) setRenaming(null);
        }}
        title={t("Rename API key")}
      >
        <form onSubmit={rename}>
          <Stack>
            {errorAlert}
            <TextInput
              label={t("Name")}
              required
              maxLength={100}
              value={renaming?.name ?? ""}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setRenaming((current) =>
                  current ? { ...current, name: value } : null,
                );
              }}
            />
            <Button
              type="submit"
              loading={busy}
              disabled={!renaming?.name.trim()}
            >
              {t("Save")}
            </Button>
          </Stack>
        </form>
      </Modal>
      <Modal
        opened={revoking !== null}
        onClose={() => {
          if (!busy) setRevoking(null);
        }}
        title={t("Revoke API key")}
      >
        <Stack>
          {errorAlert}
          <Text>
            {t(
              "Revoke {{name}}? Applications using this key will lose access immediately.",
              { name: revoking?.name },
            )}
          </Text>
          <Button color="red" loading={busy} onClick={revoke}>
            {t("Revoke")}
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

export function WorkspaceApiKeysPage() {
  return <ApiKeysPage adminView />;
}
