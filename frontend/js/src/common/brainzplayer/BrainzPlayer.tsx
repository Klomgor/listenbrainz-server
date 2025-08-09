import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faPlayCircle } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  has as _has,
  isEqual as _isEqual,
  isNil as _isNil,
  isString as _isString,
  throttle as _throttle,
  debounce,
  omit,
} from "lodash";
import * as React from "react";
import { toast } from "react-toastify";
import { Link, useLocation } from "react-router";
import { Helmet } from "react-helmet";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ToastMsg,
  createNotification,
  hasMediaSessionSupport,
  hasNotificationPermission,
  overwriteMediaSession,
  updateMediaSession,
} from "../../notifications/Notifications";
import GlobalAppContext from "../../utils/GlobalAppContext";
import BrainzPlayerUI from "./BrainzPlayerUI";
import SoundcloudPlayer from "./SoundcloudPlayer";
import SpotifyPlayer from "./SpotifyPlayer";
import YoutubePlayer from "./YoutubePlayer";
import AppleMusicPlayer from "./AppleMusicPlayer";
import {
  DataSourceKey,
  defaultDataSourcesPriority,
} from "../../settings/brainzplayer/BrainzPlayerSettings";

// Atoms
import {
  QueueRepeatModes,
  playerPausedAtom,
  setPlaybackTimerAtom,
  durationMsAtom,
  volumeAtom,
  progressMsAtom,
  updateTimeAtom,
  queueRepeatModeAtom,
  listenSubmittedAtom,
  continuousPlaybackTimeAtom,
  isActivatedAtom,
  currentTrackNameAtom,
  currentTrackArtistAtom,
  currentTrackAlbumAtom,
  currentTrackURLAtom,
  currentTrackCoverURLAtom,
  currentDataSourceIndexAtom,
  currentListenAtom,
  queueAtom,
  ambientQueueAtom,
  currentListenIndexAtom,
  addListenToTopOfQueueAtom,
  addListenToBottomOfQueueAtom,
  clearQueueAfterCurrentAndSetAmbientQueueAtom,
} from "./BrainzPlayerAtoms";

import useWindowTitle from "./hooks/useWindowTitle";
import useCrossTabSync from "./hooks/useCrossTabSync";
import useListenSubmission from "./hooks/useListenSubmission";

export type DataSourceType = {
  name: string;
  icon: IconProp;
  iconColor: string;
  playListen: (listen: Listen | JSPFTrack) => void;
  togglePlay: () => void;
  seekToPositionMs: (msTimecode: number) => void;
  canSearchAndPlayTracks: () => boolean;
  datasourceRecordsListens: () => boolean;
};

export type DataSourceTypes =
  | SpotifyPlayer
  | YoutubePlayer
  | SoundcloudPlayer
  | AppleMusicPlayer;

export type DataSourceProps = {
  show: boolean;
  volume?: number;
  playerPaused: boolean;
  onPlayerPausedChange: (paused: boolean) => void;
  onProgressChange: (progressMs: number) => void;
  onDurationChange: (durationMs: number) => void;
  onTrackInfoChange: (
    title: string,
    trackURL: string,
    artist?: string,
    album?: string,
    artwork?: Array<MediaImage>
  ) => void;
  onTrackEnd: () => void;
  onTrackNotFound: () => void;
  handleError: (error: BrainzPlayerError, title: string) => void;
  handleWarning: (message: string | JSX.Element, title: string) => void;
  handleSuccess: (message: string | JSX.Element, title: string) => void;
  onInvalidateDataSource: (
    dataSource?: DataSourceTypes,
    message?: string | JSX.Element
  ) => void;
};

/**
 * Due to some issue with TypeScript when accessing static methods of an instance when you don't know
 * which class it is, we have to manually determine the class of the instance and call MyClass.staticMethod().
 * Neither instance.constructor.staticMethod() nor instance.prototype.constructor.staticMethod() work without issues.
 * See https://github.com/Microsoft/TypeScript/issues/3841#issuecomment-337560146
 */
function isListenFromDatasource(
  listen: BaseListenFormat | Listen | JSPFTrack,
  datasource: DataSourceTypes | null
) {
  if (!listen || !datasource) {
    return undefined;
  }
  if (datasource instanceof SpotifyPlayer) {
    return SpotifyPlayer.isListenFromThisService(listen);
  }
  if (datasource instanceof YoutubePlayer) {
    return YoutubePlayer.isListenFromThisService(listen);
  }
  if (datasource instanceof SoundcloudPlayer) {
    return SoundcloudPlayer.isListenFromThisService(listen);
  }
  if (datasource instanceof AppleMusicPlayer) {
    return AppleMusicPlayer.isListenFromThisService(listen);
  }
  return undefined;
}

export default function BrainzPlayer() {
  // Global App Context
  const globalAppContext = React.useContext(GlobalAppContext);
  const {
    currentUser,
    youtubeAuth,
    spotifyAuth,
    soundcloudAuth,
    appleAuth,
    userPreferences,
    APIService,
  } = globalAppContext;

  const {
    refreshSpotifyToken,
    refreshYoutubeToken,
    refreshSoundcloudToken,
    APIBaseURI: listenBrainzAPIBaseURI,
  } = APIService;

  // Context Atoms - Values
  const volume = useAtomValue(volumeAtom);
  const queueRepeatMode = useAtomValue(queueRepeatModeAtom);

  // Context Atoms - Setters
  const setUpdateTime = useSetAtom(updateTimeAtom);
  const setProgressMs = useSetAtom(progressMsAtom);
  const setListenSubmitted = useSetAtom(listenSubmittedAtom);
  const setContinuousPlaybackTime = useSetAtom(continuousPlaybackTimeAtom);
  const setCurrentTrackCoverURL = useSetAtom(currentTrackCoverURLAtom);
  const setCurrentTrackName = useSetAtom(currentTrackNameAtom);
  const setCurrentTrackArtist = useSetAtom(currentTrackArtistAtom);
  const setCurrentTrackAlbum = useSetAtom(currentTrackAlbumAtom);
  const setCurrentTrackURL = useSetAtom(currentTrackURLAtom);
  const setCurrentDataSourceIndex = useSetAtom(currentDataSourceIndexAtom);
  const setQueue = useSetAtom(queueAtom);
  const setAmbientQueue = useSetAtom(ambientQueueAtom);
  const setCurrentListenIndex = useSetAtom(currentListenIndexAtom);

  const [playerPaused, setPlayerPaused] = useAtom(playerPausedAtom);
  const [durationMs, setDurationMs] = useAtom(durationMsAtom);
  const [currentListen, setCurrentListen] = useAtom(currentListenAtom);

  // Action Atoms
  const setPlaybackTimer = useSetAtom(setPlaybackTimerAtom);
  const addListenToTopOfQueue = useSetAtom(addListenToTopOfQueueAtom);
  const addListenToBottomOfQueue = useSetAtom(addListenToBottomOfQueueAtom);
  const clearQueueAfterCurrentAndSetAmbientQueue = useSetAtom(
    clearQueueAfterCurrentAndSetAmbientQueueAtom
  );

  const store = useStore();
  const getContinuousPlaybackTime = () => store.get(continuousPlaybackTimeAtom);
  const getProgressMs = () => store.get(progressMsAtom);
  const getListenSubmitted = () => store.get(listenSubmittedAtom);
  const getIsActivated = () => store.get(isActivatedAtom);
  const getCurrentDataSourceIndex = () => store.get(currentDataSourceIndexAtom);
  const getQueue = () => store.get(queueAtom);
  const getAmbientQueue = () => store.get(ambientQueueAtom);
  const getCurrentListenIndex = () => store.get(currentListenIndexAtom);

  // Constants
  // By how much should we seek in the track?
  const SEEK_TIME_MILLISECONDS = 5000;
  // Wait X milliseconds between start of song and sending a full listen
  const SUBMIT_LISTEN_AFTER_MS = 30000;
  // Check if it's time to submit the listen every X milliseconds
  const SUBMIT_LISTEN_UPDATE_INTERVAL = 5000;

  const brainzPlayerDisabled =
    userPreferences?.brainzplayer?.brainzplayerEnabled === false ||
    (userPreferences?.brainzplayer?.spotifyEnabled === false &&
      userPreferences?.brainzplayer?.youtubeEnabled === false &&
      userPreferences?.brainzplayer?.soundcloudEnabled === false &&
      userPreferences?.brainzplayer?.appleMusicEnabled === false);

  const {
    spotifyEnabled = true,
    appleMusicEnabled = true,
    soundcloudEnabled = true,
    youtubeEnabled = true,
    brainzplayerEnabled = true,
    dataSourcesPriority = defaultDataSourcesPriority,
  } = userPreferences?.brainzplayer ?? {};

  const enabledDataSources = [
    spotifyEnabled && SpotifyPlayer.hasPermissions(spotifyAuth) && "spotify",
    appleMusicEnabled &&
      AppleMusicPlayer.hasPermissions(appleAuth) &&
      "appleMusic",
    soundcloudEnabled &&
      SoundcloudPlayer.hasPermissions(soundcloudAuth) &&
      "soundcloud",
    youtubeEnabled && "youtube",
  ].filter(Boolean) as Array<DataSourceKey>;

  const sortedDataSources = dataSourcesPriority.filter((key) =>
    enabledDataSources.includes(key)
  );

  // Refs
  const spotifyPlayerRef = React.useRef<SpotifyPlayer>(null);
  const youtubePlayerRef = React.useRef<YoutubePlayer>(null);
  const soundcloudPlayerRef = React.useRef<SoundcloudPlayer>(null);
  const appleMusicPlayerRef = React.useRef<AppleMusicPlayer>(null);
  const dataSourceRefs: Array<React.RefObject<
    DataSourceTypes
  >> = React.useMemo(() => {
    const dataSources: Array<React.RefObject<DataSourceTypes>> = [];
    sortedDataSources.forEach((key) => {
      switch (key) {
        case "spotify":
          dataSources.push(spotifyPlayerRef);
          break;
        case "youtube":
          dataSources.push(youtubePlayerRef);
          break;
        case "soundcloud":
          dataSources.push(soundcloudPlayerRef);
          break;
        case "appleMusic":
          dataSources.push(appleMusicPlayerRef);
          break;
        default:
        // do nothing
      }
    });
    return dataSources;
  }, [sortedDataSources]);

  const playerStateTimerID = React.useRef<NodeJS.Timeout | null>(null);

  // Functions
  const alertBeforeClosingPage = (event: BeforeUnloadEvent) => {
    if (!playerPaused) {
      // Some old browsers may allow to set a custom message, but this is deprecated.
      event.preventDefault();
      // eslint-disable-next-line no-param-reassign
      event.returnValue = `You are currently playing music from this page.
      Are you sure you want to close it? Playback will be stopped.`;
      return event.returnValue;
    }
    return null;
  };

  // Handle Notifications
  const handleError = (error: BrainzPlayerError, title: string): void => {
    if (!error) {
      return;
    }
    const message = _isString(error)
      ? error
      : `${!_isNil(error.status) ? `Error ${error.status}:` : ""} ${
          error.message || error.statusText
        }`;
    toast.error(<ToastMsg title={title} message={message} />, {
      toastId: title,
    });
  };

  const handleWarning = (
    message: string | JSX.Element,
    title: string
  ): void => {
    toast.warn(<ToastMsg title={title} message={message} />, {
      toastId: title,
    });
  };

  const handleSuccess = (
    message: string | JSX.Element,
    title: string
  ): void => {
    toast.success(<ToastMsg title={title} message={message} />, {
      toastId: title,
    });
  };

  const handleInfoMessage = (
    message: string | JSX.Element,
    title: string
  ): void => {
    toast.info(<ToastMsg title={title} message={message} />, {
      toastId: title,
    });
  };

  const invalidateDataSource = (
    dataSource?: DataSourceTypes,
    message?: string | JSX.Element
  ): void => {
    let dataSourceIndex = getCurrentDataSourceIndex();
    if (dataSource) {
      dataSourceIndex = dataSourceRefs.findIndex(
        (source) => source.current === dataSource
      );
    }
    if (dataSourceIndex >= 0) {
      if (message) {
        handleWarning(message, "Cannot play from this source");
      }
      dataSourceRefs.splice(dataSourceIndex, 1);
    }
  };

  // Hooks
  const {
    htmlTitle,
    setHtmlTitle,
    currentHTMLTitle,
    updateWindowTitleWithTrackName,
    reinitializeWindowTitle,
  } = useWindowTitle();

  const { stopOtherBrainzPlayers } = useCrossTabSync(dataSourceRefs);

  const { submitCurrentListen, submitNowPlaying } = useListenSubmission({
    currentUser,
    listenBrainzAPIBaseURI,
    onError: handleError,
    onWarning: handleWarning,
    dataSourceRefs,
  });

  const checkProgressAndSubmitListen = async () => {
    if (!currentUser?.auth_token || getListenSubmitted()) {
      return;
    }
    let playbackTimeRequired = SUBMIT_LISTEN_AFTER_MS;
    if (durationMs > 0) {
      playbackTimeRequired = Math.min(
        SUBMIT_LISTEN_AFTER_MS,
        durationMs - SUBMIT_LISTEN_UPDATE_INTERVAL
      );
    }

    if (getContinuousPlaybackTime() >= playbackTimeRequired) {
      submitCurrentListen();
    }
  };

  // eslint-disable-next-line react/sort-comp
  const debouncedCheckProgressAndSubmitListen = debounce(
    checkProgressAndSubmitListen,
    SUBMIT_LISTEN_UPDATE_INTERVAL,
    {
      leading: false,
      trailing: true,
      maxWait: SUBMIT_LISTEN_UPDATE_INTERVAL,
    }
  );

  const playListen = async (
    listen: BrainzPlayerQueueItem,
    nextListenIndex: number,
    datasourceIndex: number = 0
  ): Promise<void> => {
    setCurrentListenIndex(nextListenIndex);
    setCurrentListen(listen);
    store.set(isActivatedAtom, true);
    setContinuousPlaybackTime(0);
    setListenSubmitted(false);

    window.postMessage(
      {
        brainzplayer_event: "current-listen-change",
        payload: omit(listen, "id"),
      },
      window.location.origin
    );

    let selectedDatasourceIndex: number;
    if (datasourceIndex === 0) {
      /** If available, retrieve the service the listen was listened with */
      const listenedFromIndex = dataSourceRefs.findIndex((datasourceRef) => {
        const { current } = datasourceRef;
        return isListenFromDatasource(listen, current);
      });
      selectedDatasourceIndex =
        listenedFromIndex === -1 ? 0 : listenedFromIndex;
    } else {
      /** If no matching datasource was found, revert to the default bahaviour
       * (try playing from source 0 or try next source)
       */
      selectedDatasourceIndex = datasourceIndex;
    }

    const datasource = dataSourceRefs[selectedDatasourceIndex]?.current;
    if (!datasource) {
      return;
    }
    // Check if we can play the listen with the selected datasource
    // otherwise skip to the next datasource without trying or setting currentDataSourceIndex
    // This prevents rendering datasource iframes when we can't use the datasource
    if (
      !isListenFromDatasource(listen, datasource) &&
      !datasource.canSearchAndPlayTracks()
    ) {
      playListen(listen, nextListenIndex, datasourceIndex + 1);
      return;
    }
    stopOtherBrainzPlayers();
    setCurrentDataSourceIndex(selectedDatasourceIndex);

    // wait for isActive to be true
    const intervalID = setInterval(() => {
      // Wait for isActivated to be true
      if (getIsActivated()) {
        datasource.playListen(listen);
        clearInterval(intervalID);
      }
    }, 200);
  };

  const stopPlayerStateTimer = (): void => {
    debouncedCheckProgressAndSubmitListen.flush();
    if (playerStateTimerID.current) {
      clearInterval(playerStateTimerID.current);
    }
    playerStateTimerID.current = null;
  };

  const playNextTrack = (invert: boolean = false): void => {
    if (!getIsActivated()) {
      // Player has not been activated by the user, do nothing.
      return;
    }
    debouncedCheckProgressAndSubmitListen.flush();

    const currentQueue = getQueue();
    const currentAmbientQueue = getAmbientQueue();

    if (currentQueue.length === 0 && currentAmbientQueue.length === 0) {
      handleWarning(
        "You can try loading listens or refreshing the page",
        "No listens to play"
      );
      return;
    }

    const currentPlayingListenIndex = getCurrentListenIndex();

    let nextListenIndex: number;
    // If the queue repeat mode is one, then play the same track again
    if (queueRepeatMode === QueueRepeatModes.one) {
      nextListenIndex =
        currentPlayingListenIndex + (currentPlayingListenIndex < 0 ? 1 : 0);
    } else {
      // Otherwise, play the next track in the queue
      nextListenIndex = currentPlayingListenIndex + (invert === true ? -1 : 1);
    }

    // If nextListenIndex is less than 0, wrap around to the last track in the queue
    if (nextListenIndex < 0) {
      nextListenIndex = currentQueue.length - 1;
    }

    // If nextListenIndex is within the queue length, play the next track
    if (nextListenIndex < currentQueue.length) {
      const nextListen = currentQueue[nextListenIndex];
      playListen(nextListen, nextListenIndex, 0);
      return;
    }

    // If the nextListenIndex is greater than the queue length, i.e. the queue has ended, then there are three possibilities:
    // 1. If there are listens in the ambient queue, then play the first listen in the ambient queue.
    //    In this case, we'll move the first listen from the ambient queue to the main queue and play it.
    // 2. If there are no listens in the ambient queue, then play the first listen in the main queue.
    if (currentAmbientQueue.length > 0) {
      const ambientQueueTop = currentAmbientQueue.shift();
      if (ambientQueueTop) {
        const currentQueueLength = currentQueue.length;
        addListenToBottomOfQueue(ambientQueueTop);
        const nextListen = getQueue()[currentQueueLength];
        setAmbientQueue(currentAmbientQueue);
        playListen(nextListen, currentQueueLength, 0);
        return;
      }
    } else if (queueRepeatMode === QueueRepeatModes.off) {
      // 3. If there are no listens in the ambient queue and the queue repeat mode is off, then stop the player
      stopPlayerStateTimer();
      reinitializeWindowTitle();
      return;
    }

    // If there are no listens in the ambient queue, then play the first listen in the main queue
    nextListenIndex = 0;
    const nextListen = currentQueue[nextListenIndex];
    if (!nextListen) {
      handleWarning(
        "You can try loading listens or refreshing the page",
        "No listens to play"
      );
      return;
    }
    playListen(nextListen, nextListenIndex, 0);
  };

  const playPreviousTrack = (): void => {
    playNextTrack(true);
  };

  const progressChange = (newProgressMs: number): void => {
    setProgressMs(newProgressMs);
    setUpdateTime(performance.now());
  };

  const seekToPositionMs = (msTimecode: number): void => {
    if (!getIsActivated()) {
      // Player has not been activated by the user, do nothing.
      return;
    }
    const dataSource = dataSourceRefs[getCurrentDataSourceIndex()]?.current;
    if (!dataSource) {
      invalidateDataSource();
      return;
    }
    dataSource.seekToPositionMs(msTimecode);
    progressChange(msTimecode);
  };

  const seekForward = (): void => {
    seekToPositionMs(getProgressMs() + SEEK_TIME_MILLISECONDS);
  };

  const seekBackward = (): void => {
    seekToPositionMs(getProgressMs() - SEEK_TIME_MILLISECONDS);
  };

  const mediaSessionHandlers = [
    { action: "previoustrack", handler: playPreviousTrack },
    { action: "nexttrack", handler: playNextTrack },
    { action: "seekbackward", handler: seekBackward },
    { action: "seekforward", handler: seekForward },
  ];

  const activatePlayerAndPlay = (): void => {
    overwriteMediaSession(mediaSessionHandlers);
    store.set(isActivatedAtom, true);
    playNextTrack();
  };

  const togglePlay = async (): Promise<void> => {
    try {
      const dataSource = dataSourceRefs[getCurrentDataSourceIndex()]?.current;
      if (!dataSource) {
        invalidateDataSource();
        return;
      }
      if (playerPaused) {
        stopOtherBrainzPlayers();
      }
      await dataSource.togglePlay();
    } catch (error) {
      handleError(error, "Could not play");
    }
  };

  /* Updating the progress bar without calling any API to check current player state */
  const updatePlayerProgressBar = (): void => {
    setPlaybackTimer();
  };

  const startPlayerStateTimer = (): void => {
    stopPlayerStateTimer();
    playerStateTimerID.current = setInterval(() => {
      updatePlayerProgressBar();
      debouncedCheckProgressAndSubmitListen();
    }, 400);
  };

  /* Listeners for datasource events */
  const failedToPlayTrack = (): void => {
    if (!getIsActivated()) {
      // Player has not been activated by the user, do nothing.
      return;
    }

    if (
      currentListen &&
      getCurrentDataSourceIndex() < dataSourceRefs.length - 1
    ) {
      // Try playing the listen with the next dataSource
      playListen(
        currentListen,
        getCurrentListenIndex(),
        getCurrentDataSourceIndex() + 1
      );
    } else {
      handleWarning(
        <>
          We tried searching for this track on the music services you are
          connected to, but did not find a match to play.
          <br />
          To enable more music services please go to the{" "}
          <Link to="/settings/brainzplayer/">music player preferences.</Link>
        </>,
        "Could not find a match"
      );
      stopPlayerStateTimer();
      playNextTrack();
    }
  };

  const playerPauseChange = (paused: boolean): void => {
    setPlayerPaused(paused);
    if (paused) {
      stopPlayerStateTimer();
      reinitializeWindowTitle();
    } else {
      startPlayerStateTimer();
      updateWindowTitleWithTrackName();
    }
    if (hasMediaSessionSupport()) {
      window.navigator.mediaSession.playbackState = paused
        ? "paused"
        : "playing";
    }
  };

  const durationChange = (newDurationMs: number): void => {
    setDurationMs(newDurationMs);
  };

  // Effect to start the timer when durationMs changes
  React.useEffect(() => {
    if (durationMs > 0) {
      startPlayerStateTimer();
    }
  }, [durationMs]);

  const trackInfoChange = (
    title: string,
    trackURL: string,
    artist?: string,
    album?: string,
    artwork?: Array<MediaImage>
  ): void => {
    setCurrentTrackName(title);
    setCurrentTrackArtist(artist!);
    setCurrentTrackAlbum(album);
    setCurrentTrackURL(trackURL);
    setCurrentTrackCoverURL(artwork?.[0]?.src);

    updateWindowTitleWithTrackName();
    if (!playerPaused) {
      submitNowPlaying();
    }
    if (playerPaused) {
      // Don't send notifications or any of that if the player is not playing
      // (Avoids getting notifications upon pausing a track)
      return;
    }

    if (hasMediaSessionSupport()) {
      overwriteMediaSession(mediaSessionHandlers);
      updateMediaSession(title, artist, album, artwork);
    }
    // Send a notification. If user allowed browser/OS notifications use that,
    // otherwise show a toast notification on the page
    hasNotificationPermission().then((permissionGranted) => {
      if (permissionGranted) {
        createNotification(title, artist, album, artwork?.[0]?.src);
      } else {
        const message = (
          <div className="alert brainzplayer-alert">
            {artwork?.length ? (
              <img
                className="alert-thumbnail"
                src={artwork[0].src}
                alt={album || title}
              />
            ) : (
              <FontAwesomeIcon icon={faPlayCircle as IconProp} />
            )}
            <div>
              {title}
              {artist && ` — ${artist}`}
              {album && ` — ${album}`}
            </div>
          </div>
        );
        handleInfoMessage(message, `Playing a track`);
      }
    });
  };

  const clearQueue = async (): Promise<void> => {
    const currentQueue = getQueue();

    // Clear the queue by keeping only the currently playing song
    const currentPlayingListenIndex = getCurrentListenIndex();
    setQueue(
      currentQueue[currentPlayingListenIndex]
        ? [currentQueue[currentPlayingListenIndex]]
        : []
    );
    setCurrentListenIndex(0);
  };

  const playNextListenFromQueue = (datasourceIndex: number = 0): void => {
    const currentPlayingListenIndex = getCurrentListenIndex();
    const nextTrack = getQueue()[currentPlayingListenIndex + 1];
    playListen(nextTrack, currentPlayingListenIndex + 1, datasourceIndex);
  };

  const playListenEventHandler = (listen: Listen | JSPFTrack) => {
    addListenToTopOfQueue(listen);
    playNextListenFromQueue();
  };

  const playAmbientQueue = (tracks: BrainzPlayerQueue): void => {
    // 1. Clear the items in the queue after the current playing track
    store.set(isActivatedAtom, true);
    clearQueueAfterCurrentAndSetAmbientQueue(tracks);

    // 2. Play the first item in the ambient queue
    playNextTrack();
  };

  // eslint-disable-next-line react/sort-comp
  const throttledTrackInfoChange = _throttle(trackInfoChange, 2000, {
    leading: false,
    trailing: true,
  });

  const receiveBrainzPlayerMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin) {
      // Received postMessage from different origin, ignoring it
      return;
    }
    const { brainzplayer_event, payload } = event.data;
    if (!brainzplayer_event) {
      return;
    }
    if (userPreferences?.brainzplayer) {
      if (brainzPlayerDisabled) {
        toast.info(
          <ToastMsg
            title="BrainzPlayer disabled"
            message={
              <>
                You have disabled all music services for playback on
                ListenBrainz. To enable them again, please go to the{" "}
                <Link to="/settings/brainzplayer/">
                  music player preferences
                </Link>{" "}
                page
              </>
            }
          />
        );
        return;
      }
    }
    switch (brainzplayer_event) {
      case "play-listen":
        playListenEventHandler(payload);
        break;
      case "force-play":
        togglePlay();
        break;
      case "play-ambient-queue":
        playAmbientQueue(payload);
        break;
      default:
      // do nothing
    }
  };

  React.useEffect(() => {
    window.addEventListener("message", receiveBrainzPlayerMessage);
    window.addEventListener("beforeunload", alertBeforeClosingPage);
    // Remove SpotifyPlayer if the user doesn't have the relevant permissions to use it
    if (
      !SpotifyPlayer.hasPermissions(spotifyAuth) &&
      spotifyPlayerRef?.current
    ) {
      invalidateDataSource(spotifyPlayerRef.current);
    }
    if (
      !SoundcloudPlayer.hasPermissions(soundcloudAuth) &&
      soundcloudPlayerRef?.current
    ) {
      invalidateDataSource(soundcloudPlayerRef.current);
    }
    return () => {
      window.removeEventListener("message", receiveBrainzPlayerMessage);
      window.removeEventListener("beforeunload", alertBeforeClosingPage);
      stopPlayerStateTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotifyAuth, soundcloudAuth]);

  const { pathname } = useLocation();

  // Hide the player if user is on homepage and the player is not activated, and there are nothing in both the queue
  if (
    pathname === "/" &&
    !getIsActivated() &&
    getQueue().length === 0 &&
    getAmbientQueue().length === 0
  ) {
    return null;
  }

  return (
    <div
      data-testid="brainzplayer"
      className={!brainzplayerEnabled ? "hidden" : ""}
    >
      {!playerPaused && (
        <Helmet
          key={htmlTitle}
          onChangeClientState={(newState) => {
            if (newState.title && !newState.title.includes("🎵")) {
              setHtmlTitle(newState.title?.replace(" - ListenBrainz", ""));
            }
          }}
        >
          <title>{currentHTMLTitle}</title>
        </Helmet>
      )}
      <BrainzPlayerUI
        disabled={brainzPlayerDisabled}
        playPreviousTrack={playPreviousTrack}
        playNextTrack={playNextTrack}
        togglePlay={getIsActivated() ? togglePlay : activatePlayerAndPlay}
        seekToPositionMs={seekToPositionMs}
        listenBrainzAPIBaseURI={listenBrainzAPIBaseURI}
        currentDataSource={dataSourceRefs[getCurrentDataSourceIndex()]?.current}
        clearQueue={clearQueue}
      >
        {userPreferences?.brainzplayer?.spotifyEnabled !== false && (
          <SpotifyPlayer
            volume={volume}
            show={
              getIsActivated() &&
              dataSourceRefs[getCurrentDataSourceIndex()]?.current instanceof
                SpotifyPlayer
            }
            refreshSpotifyToken={refreshSpotifyToken}
            onInvalidateDataSource={invalidateDataSource}
            ref={spotifyPlayerRef}
            playerPaused={playerPaused}
            onPlayerPausedChange={playerPauseChange}
            onProgressChange={progressChange}
            onDurationChange={durationChange}
            onTrackInfoChange={throttledTrackInfoChange}
            onTrackEnd={playNextTrack}
            onTrackNotFound={failedToPlayTrack}
            handleError={handleError}
            handleWarning={handleWarning}
            handleSuccess={handleSuccess}
          />
        )}
        {userPreferences?.brainzplayer?.youtubeEnabled !== false && (
          <YoutubePlayer
            volume={volume}
            show={
              getIsActivated() &&
              dataSourceRefs[getCurrentDataSourceIndex()]?.current instanceof
                YoutubePlayer
            }
            onInvalidateDataSource={invalidateDataSource}
            ref={youtubePlayerRef}
            youtubeUser={youtubeAuth}
            refreshYoutubeToken={refreshYoutubeToken}
            playerPaused={playerPaused}
            onPlayerPausedChange={playerPauseChange}
            onProgressChange={progressChange}
            onDurationChange={durationChange}
            onTrackInfoChange={throttledTrackInfoChange}
            onTrackEnd={playNextTrack}
            onTrackNotFound={failedToPlayTrack}
            handleError={handleError}
            handleWarning={handleWarning}
            handleSuccess={handleSuccess}
          />
        )}
        {userPreferences?.brainzplayer?.soundcloudEnabled !== false && (
          <SoundcloudPlayer
            volume={volume}
            show={
              getIsActivated() &&
              dataSourceRefs[getCurrentDataSourceIndex()]?.current instanceof
                SoundcloudPlayer
            }
            onInvalidateDataSource={invalidateDataSource}
            ref={soundcloudPlayerRef}
            refreshSoundcloudToken={refreshSoundcloudToken}
            playerPaused={playerPaused}
            onPlayerPausedChange={playerPauseChange}
            onProgressChange={progressChange}
            onDurationChange={durationChange}
            onTrackInfoChange={throttledTrackInfoChange}
            onTrackEnd={playNextTrack}
            onTrackNotFound={failedToPlayTrack}
            handleError={handleError}
            handleWarning={handleWarning}
            handleSuccess={handleSuccess}
          />
        )}
        {userPreferences?.brainzplayer?.appleMusicEnabled !== false && (
          <AppleMusicPlayer
            volume={volume}
            show={
              getIsActivated() &&
              dataSourceRefs[getCurrentDataSourceIndex()]?.current instanceof
                AppleMusicPlayer
            }
            onInvalidateDataSource={invalidateDataSource}
            ref={appleMusicPlayerRef}
            playerPaused={playerPaused}
            onPlayerPausedChange={playerPauseChange}
            onProgressChange={progressChange}
            onDurationChange={durationChange}
            onTrackInfoChange={throttledTrackInfoChange}
            onTrackEnd={playNextTrack}
            onTrackNotFound={failedToPlayTrack}
            handleError={handleError}
            handleWarning={handleWarning}
            handleSuccess={handleSuccess}
          />
        )}
      </BrainzPlayerUI>
    </div>
  );
}
