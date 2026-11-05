import {
  ActionIcon,
  Badge,
  Box,
  Group,
  Text,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import classes from "./app-header.module.css";
import React from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { IconChevronRight, IconSparkles } from "@tabler/icons-react";
import useToggleAside from "@/hooks/use-toggle-aside.tsx";
import APP_ROUTE from "@/lib/app-route.ts";
import { useAtom } from "jotai";
import {
  desktopSidebarAtom,
  mobileSidebarAtom,
} from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import SidebarToggle from "@/components/ui/sidebar-toggle-button.tsx";
import { useTranslation } from "react-i18next";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { getSpaceUrl, isCloud } from "@/lib/config.ts";
import { NotificationPopover } from "@/features/notification/components/notification-popover.tsx";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";

const links = [
  { link: APP_ROUTE.HOME, label: "Home" },
  { link: "/favorites", label: "Favorites" },
  { link: "/spaces", label: "Spaces" },
  { link: "/templates", label: "Templates" },
  { link: "/settings", label: "Settings" },
  { link: "/ai", label: "AI Chat" },
];

export function AppHeader() {
  const { t } = useTranslation();
  const [mobileOpened] = useAtom(mobileSidebarAtom);
  const toggleMobile = useToggleSidebar(mobileSidebarAtom);

  const [desktopOpened] = useAtom(desktopSidebarAtom);
  const toggleDesktop = useToggleSidebar(desktopSidebarAtom);
  const { isTrial, trialDaysLeft } = useTrial();
  const location = useLocation();
  const { spaceSlug } = useParams();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const toggleAside = useToggleAside();
  const [workspace] = useAtom(workspaceAtom);
  const aiChatEnabled = workspace?.settings?.ai?.chat === true;

  const isPageRoute = location.pathname.includes("/p/");

  const currentLink = links.find(
    ({ link }) =>
      location.pathname === link || location.pathname.startsWith(`${link}/`),
  );

  return (
    <>
      <Group h="100%" px="xs" justify="space-between" wrap={"nowrap"} gap="xs">
        <Group wrap="nowrap" gap="xs" miw={0}>
          <Tooltip label={t("Sidebar toggle")}>
            <SidebarToggle
              aria-label={t("Sidebar toggle")}
              opened={mobileOpened}
              onClick={toggleMobile}
              hiddenFrom="sm"
              size="sm"
            />
          </Tooltip>

          <Tooltip label={t("Sidebar toggle")}>
            <SidebarToggle
              aria-label={t("Sidebar toggle")}
              opened={desktopOpened}
              onClick={toggleDesktop}
              visibleFrom="sm"
              size="sm"
            />
          </Tooltip>

          <Link to="/home" className={classes.brand} aria-label="Docmost">
            <Box hiddenFrom="sm" className={classes.brandIcon}>
              <img
                src="/icons/favicon-32x32.png"
                alt="Docmost"
                width={22}
                height={22}
              />
            </Box>
            <Text
              size="sm"
              fw={600}
              style={{ userSelect: "none" }}
              visibleFrom="sm"
            >
              {workspace?.name ?? "Docmost"}
            </Text>
          </Link>

          {(space || currentLink) && (
            <Group gap={5} wrap="nowrap" visibleFrom="sm" miw={0}>
              <IconChevronRight
                size={13}
                color="var(--mantine-color-dimmed)"
                style={{ flexShrink: 0 }}
              />
              <Link
                to={
                  space
                    ? getSpaceUrl(space.slug)
                    : currentLink.link === "/settings"
                      ? APP_ROUTE.SETTINGS.ACCOUNT.PROFILE
                      : currentLink.link
                }
                className={classes.link}
              >
                {space?.name ?? t(currentLink.label)}
              </Link>
            </Group>
          )}
        </Group>

        <Group gap="xs" wrap="nowrap">
          {aiChatEnabled && (
            <>
              <UnstyledButton
                component={Link}
                to="/ai"
                className={classes.link}
                visibleFrom="sm"
                onClick={(e: React.MouseEvent) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) {
                    return;
                  }
                  if (isPageRoute) {
                    e.preventDefault();
                    toggleAside("chat");
                  }
                }}
              >
                {t("AI Chat")}
              </UnstyledButton>
              <Tooltip label={t("AI Chat")} openDelay={250} withArrow>
                <ActionIcon
                  component={Link}
                  to="/ai"
                  variant="subtle"
                  color="dark"
                  size="sm"
                  hiddenFrom="sm"
                  aria-label={t("AI Chat")}
                  onClick={(e: React.MouseEvent) => {
                    if (
                      e.metaKey ||
                      e.ctrlKey ||
                      e.shiftKey ||
                      e.button === 1
                    ) {
                      return;
                    }
                    if (isPageRoute) {
                      e.preventDefault();
                      toggleAside("chat");
                    }
                  }}
                >
                  <IconSparkles size={20} stroke={2} />
                </ActionIcon>
              </Tooltip>
            </>
          )}
          <NotificationPopover />
          {isCloud() && isTrial && trialDaysLeft !== 0 && (
            <Badge
              variant="light"
              style={{ cursor: "pointer" }}
              component={Link}
              to={APP_ROUTE.SETTINGS.WORKSPACE.BILLING}
              visibleFrom="xs"
            >
              {trialDaysLeft === 1
                ? "1 day left"
                : `${trialDaysLeft} days left`}
            </Badge>
          )}
        </Group>
      </Group>
    </>
  );
}
