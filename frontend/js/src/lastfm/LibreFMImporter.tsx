import * as React from "react";

import { IconProp } from "@fortawesome/fontawesome-svg-core";
import { faHeart } from "@fortawesome/free-regular-svg-icons";
import { faCheck, faSpinner, faTimes } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { capitalize } from "lodash";
import { toast } from "react-toastify";
import { Link } from "react-router";
import APIService from "../utils/APIService";
import Scrobble from "../utils/Scrobble";
import LibreFMImporterModal from "./LibreFMImporterModal";
import Pill from "../components/Pill";

export const RETRIES = 3;

export type ImporterProps = {
  user: {
    id?: string;
    name: string;
    auth_token: string;
  };
  profileUrl?: string;
  apiUrl?: string;
  librefmApiUrl: string;
  librefmApiKey: string;
};

export type ImporterState = {
  show: boolean;
  canClose: boolean;
  librefmUsername: string;
  msg?: React.ReactElement;
  service: ImportService;
};

export default class LibreFmImporter extends React.Component<
  ImporterProps,
  ImporterState
> {
  static encodeScrobbles(
    scrobbles: LastFmScrobblePage,
    service: ImportService = "librefm"
  ): any {
    const rawScrobbles = scrobbles.recenttracks.track;
    const parsedScrobbles = LibreFmImporter.map((rawScrobble: any) => {
      const scrobble = new Scrobble(rawScrobble, service);
      return scrobble.asJSONSerializable();
    }, rawScrobbles);
    return parsedScrobbles;
  }

  static map(applicable: (collection: any) => Listen, collection: any) {
    const newCollection = [];
    for (let i = 0; i < collection.length; i += 1) {
      const result = applicable(collection[i]);
      if (result.listened_at > 0) {
        // If the 'listened_at' attribute is -1 then either the listen is invalid or the
        // listen is currently playing. In both cases we need to skip the submission.
        newCollection.push(result);
      }
    }
    return newCollection;
  }

  APIService: APIService;
  private librefmURL: string;
  private librefmKey: string;

  private userName: string;
  private userToken: string;
  private userIsPrivate: boolean;

  private page = 1;
  private totalPages = 0;

  private playCount = -1; // the number of scrobbles reported by Last.FM
  private countReceived = 0; // number of scrobbles the Last.FM API sends us, this can be diff from playCount

  private latestImportTime = 0; // the latest timestamp that we've imported earlier
  private maxTimestampForImport = 0; // the latest listen found in this import
  private lastImportedString = ""; // date formatted string of first song on payload's timestamp
  private incrementalImport = false;

  private numCompleted = 0; // number of pages completed till now

  // Variables used to honor LB's rate limit
  private rlRemain = -1;
  private rlReset = -1;

  private rlOrigin = -1;

  constructor(props: ImporterProps) {
    super(props);

    this.state = {
      show: false,
      canClose: true,
      librefmUsername: "",
      msg: undefined,
      service: "librefm",
    };

    this.APIService = new APIService(
      props.apiUrl || `${window.location.origin}/1`
    ); // Used to access LB API

    this.librefmKey = props.librefmApiKey;
    this.librefmURL = props.librefmApiUrl;

    this.userName = props.user.name;
    this.userToken = props.user.auth_token || "";
    this.userIsPrivate = false;
  }

  async getTotalNumberOfScrobbles() {
    /*
     * Get the total play count reported by Last.FM for user
     */
    const { librefmUsername } = this.state;
    const url = `${this.librefmURL}?method=user.getinfo&user=${librefmUsername}&api_key=${this.librefmKey}&format=json`;
    let wrong_username = false;
    try {
      const response = await fetch(encodeURI(url));
      const data = await response.json();
      if (data?.message === "User not found") {
        wrong_username = true;
        throw new Error();
      }
      if ("playcount" in data.user) {
        return Number(data.user.playcount);
      }
      return -1;
    } catch {
      this.updateModalAction(
        <p>An error occurred, please try again. :(</p>,
        true
      );
      const error = new Error();
      if (wrong_username) {
        error.message = "User not found";
      } else {
        error.message = "Something went wrong";
      }
      throw error;
    }
  }

  async getNumberOfPages() {
    /*
     * Get the total pages of data from last import
     */
    const { librefmUsername } = this.state;

    const url = `${
      this.librefmURL
    }?method=user.getrecenttracks&user=${librefmUsername}&api_key=${
      this.librefmKey
    }&from=${this.latestImportTime + 1}&format=json`;
    try {
      const response = await fetch(encodeURI(url));
      const data = await response.json();
      if ("recenttracks" in data) {
        return Number(data.recenttracks["@attr"].totalPages);
      }
      return 0;
    } catch (err) {
      this.updateModalAction(
        <p>An error occurred, please try again. :(</p>,
        true
      );
      return -1;
    }
  }

  /*
   * @param {number} page - the page to fetch from Last.fm
   * @param {number} retries - number times to retry in case of errors other than 40x
   * Fetch page from Last.fm
   * @returns Returns an array of Listens if successful, null if it exceeds the max number of retries (consider that an error)
   * and undefined if we receive a 40X error for the page
   */
  async getPage(
    page: number,
    retries: number
  ): Promise<Array<Listen> | undefined> {
    const { librefmUsername, service } = this.state;
    const timeout = 3000;

    const url = `${
      this.librefmURL
    }?method=user.getrecenttracks&user=${librefmUsername}&api_key=${
      this.librefmKey
    }&from=${this.latestImportTime + 1}&page=${page}&format=json`;
    try {
      const response = await fetch(encodeURI(url));
      if (response.ok) {
        const data = await response.json();
        // Set latest import time
        if ("date" in data.recenttracks.track[0]) {
          this.maxTimestampForImport = Math.max(
            data.recenttracks.track[0].date.uts,
            this.maxTimestampForImport
          );
        } else {
          this.maxTimestampForImport = Math.floor(Date.now() / 1000);
        }

        // Encode the page so that it can be submitted
        const payload = LibreFmImporter.encodeScrobbles(data, service);
        this.countReceived += payload.length;
        return payload;
      }
      // Retry if we receive a 5xx server error
      if (/^5/.test(response.status.toString())) {
        throw new Error(`Status ${response.status}`);
      }
    } catch (err) {
      // Retry if there is a network error
      if (retries <= 0) {
        throw new Error(
          `Failed to fetch page ${page} from ${service} after ${RETRIES} retries: ${err.toString()}`
        );
      }
      await new Promise((resolve) => {
        setTimeout(resolve, timeout);
      });
      // eslint-disable-next-line no-return-await
      return await this.getPage(page, retries - 1);
    }
    return undefined;
  }

  async getUserPrivacy() {
    /*
     * Determine if user's last.fm scrobbles are private
     */
    const { librefmUsername } = this.state;
    const url = `${this.librefmURL}?method=user.getrecenttracks&user=${librefmUsername}&api_key=${this.librefmKey}&format=json`;
    try {
      const response = await fetch(encodeURI(url));
      const data = await response.json();
      return data.error === 17;
    } catch (error) {
      this.updateModalAction(
        <p>An error occurred, please try again. :(</p>,
        true
      );
      throw error;
    }
  }

  static getlastImportedString(listen: Listen) {
    // Retrieve first track's timestamp from payload and convert it into string for display
    const lastImportedDate = new Date(listen.listened_at * 1000);
    return lastImportedDate.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
  }

  getRateLimitDelay() {
    /* Get the amount of time we should wait according to LB rate limits before making a request to LB */
    let delay = 0;
    const current = new Date().getTime() / 1000;
    if (this.rlReset < 0 || current > this.rlOrigin + this.rlReset) {
      delay = 0;
    } else if (this.rlRemain > 0) {
      delay = Math.max(0, Math.ceil((this.rlReset * 1000) / this.rlRemain));
    } else {
      delay = Math.max(0, Math.ceil(this.rlReset * 1000));
    }
    return delay;
  }

  updateModalAction = (msg: React.ReactElement, canClose: boolean) => {
    this.setState({
      msg,
      canClose,
    });
  };

  toggleModal = () => {
    this.setState((prevState) => {
      return { show: !prevState.show };
    });
  };

  setClose = (canClose: boolean) => {
    this.setState({ canClose });
  };

  handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    this.setState({ librefmUsername: event.target.value });
  };

  handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    this.toggleModal();
    this.startImport();
  };

  importFeedback = async () => {
    const { librefmUsername, service } = this.state;
    if (!librefmUsername || service !== "lastfm") {
      return;
    }
    const { importFeedback } = this.APIService;
    try {
      const response = await importFeedback(
        this.userToken,
        librefmUsername,
        service
      );
      const { inserted, total } = response;
      toast.success(
        <div>
          Succesfully imported {inserted} out of {total} tracks feedback from{" "}
          {capitalize(service)}
          <br />
          <Link to="/my/taste">Click here to see your newly loved tracks</Link>
        </div>
      );
    } catch (error) {
      toast.error(
        <div>
          We were unable to import your loved tracks from {capitalize(service)},
          please try again later.
          <br />
          If the problem persists please{" "}
          <a href="mailto:support@metabrainz.org">contact us</a>.
          <pre>{error.toString()}</pre>
        </div>
      );
    }
  };

  progressBarPercentage() {
    if (this.totalPages >= this.numCompleted)
      return Math.ceil((this.numCompleted / this.totalPages) * 100);
    return 50;
  }

  async submitPage(payload: Array<Listen>) {
    const delay = this.getRateLimitDelay();
    // Halt execution for some time
    await new Promise((resolve) => {
      setTimeout(resolve, delay);
    });

    const response = await this.APIService.submitListens(
      this.userToken,
      "import",
      payload
    );
    this.updateRateLimitParameters(response);
  }

  async importLoop() {
    while (this.page > 0) {
      // Fixing no-await-in-loop will require significant changes to the code, ignoring for now
      this.lastImportedString = "...";
      const payload = await this.getPage(this.page, RETRIES); // eslint-disable-line

      if (payload) {
        // Submit only if response is valid
        this.submitPage(payload);
        this.lastImportedString = LibreFmImporter.getlastImportedString(
          payload[0]
        );
      }

      this.page -= 1;
      this.numCompleted += 1;
      const progressBarPercentage = this.progressBarPercentage();

      // Update message
      const msg = (
        <p>
          <FontAwesomeIcon icon={faSpinner as IconProp} spin /> Sending page{" "}
          {this.numCompleted} of {this.totalPages} to ListenBrainz <br />
          <span style={{ fontSize: `${8}pt` }}>
            {this.incrementalImport && (
              <span>
                Note: This import will stop at the starting point of your last
                import. :)
                <br />
              </span>
            )}
            <span>
              Closing this page during import may require a full restart of the
              importer from the beginning.
            </span>{" "}
            <br /> <br />
            <div className="progress" style={{ height: "7px" }}>
              <div
                className="progress-bar progress-bar-striped progress-bar-animated"
                role="progressbar"
                style={{ width: `${progressBarPercentage}%` }}
                aria-label="Importer Progress"
                aria-valuenow={progressBarPercentage}
                aria-valuemin={0}
                aria-valuemax={100}
              />
            </div>
            <span> Latest import timestamp: {this.lastImportedString} </span>
          </span>
        </p>
      );
      this.setState({ msg });
    }
  }

  async startImport() {
    let finalMsg: JSX.Element;
    const { profileUrl } = this.props;
    const { service } = this.state;
    this.updateModalAction(
      <p>Your import from {service} is starting!</p>,
      false
    );

    try {
      const data = await this.APIService.getLatestImport(
        this.userName,
        service
      );
      this.latestImportTime = data.latest_import;
      this.incrementalImport = this.latestImportTime > 0;
      this.playCount = await this.getTotalNumberOfScrobbles();
      this.totalPages = await this.getNumberOfPages();
      this.userIsPrivate = await this.getUserPrivacy();
      this.page = this.totalPages; // Start from the last page so that oldest scrobbles are imported first
      this.numCompleted = 0;

      await this.importLoop(); // import pages
    } catch (err) {
      // import failed, show final message on unhandled exception / unrecoverable network error
      finalMsg = (
        <p>
          <FontAwesomeIcon icon={faTimes as IconProp} /> We were unable to
          import from {service}, please try again.
          <br />
          If the problem persists please contact us.
          <br />
          {err.toString()}
          <br />
          <span style={{ fontSize: `${10}pt` }}>
            <a href={`${profileUrl}`}>
              Close and go to your ListenBrainz settings
            </a>
          </span>
        </p>
      );
      this.setState({ canClose: true, msg: finalMsg });
      return Promise.resolve(null);
    }

    // import was successful
    try {
      this.maxTimestampForImport = Math.max(
        Number(this.maxTimestampForImport),
        this.latestImportTime
      );
      this.APIService.setLatestImport(
        this.userToken,
        service,
        this.maxTimestampForImport
      );
    } catch {
      setTimeout(
        () =>
          this.APIService.setLatestImport(
            this.userToken,
            service,
            this.maxTimestampForImport
          ),
        3000
      );
    }
    finalMsg = (
      <p>
        <FontAwesomeIcon icon={faCheck as IconProp} />
        Import finished
        <br />
        <span style={{ fontSize: `${8}pt` }}>
          Successfully submitted {this.countReceived} listens to ListenBrainz
          <br />
        </span>
        {/* if the count received is different from the api count, show a message accordingly
         * also don't show this message if it's an incremental import, because countReceived
         * and playCount will be different by definition in incremental imports
         */}
        {!this.incrementalImport &&
          this.playCount !== -1 &&
          this.countReceived !== this.playCount && (
            <b>
              <span style={{ fontSize: `${10}pt` }} className="text-danger">
                The number submitted listens is different from the{" "}
                {this.playCount} that {service} reports due to an inconsistency
                in their API, sorry!
                <br />
              </span>
            </b>
          )}
        <span style={{ fontSize: `${8}pt` }}>
          Thank you for using ListenBrainz!
        </span>
        <br />
        <br />
        <span style={{ fontSize: `${10}pt` }}>
          <a href={`${profileUrl}`}>
            Close and go to your ListenBrainz settings
          </a>
        </span>
      </p>
    );

    // If the user's last.fm scrobbles are private, prompt user to check their settings
    if (this.userIsPrivate) {
      finalMsg = (
        <p>
          <FontAwesomeIcon icon={faTimes as IconProp} /> Import failed
          <br />
          <br />
          <b style={{ fontSize: `${10}pt` }} className="text-danger">
            Please make sure your Last.fm recent listening information is public
            by updating your privacy settings
            <a href="https://www.last.fm/settings/privacy"> here. </a>
          </b>
          <br />
          <span style={{ fontSize: `${8}pt` }}>
            Thank you for using ListenBrainz!
          </span>
          <br />
          <br />
          <span style={{ fontSize: `${10}pt` }}>
            <a href={`${profileUrl}`}>
              Close and go to your ListenBrainz settings
            </a>
          </span>
        </p>
      );
    }
    this.setState({ canClose: true, msg: finalMsg });
    return Promise.resolve(null);
  }

  updateRateLimitParameters(response: Response) {
    /* Update the variables we use to honor LB's rate limits */
    if (response?.headers?.get("X-RateLimit-Remaining")) {
      this.rlRemain = Number(response.headers.get("X-RateLimit-Remaining"));
    }
    if (response?.headers?.get("X-RateLimit-Reset-In")) {
      this.rlReset = Number(response.headers.get("X-RateLimit-Reset-In"));
    }
    this.rlOrigin = new Date().getTime() / 1000;
  }

  render() {
    const { show, canClose, librefmUsername, msg, service } = this.state;
    return (
      <div className="Importer">
        <form onSubmit={this.handleSubmit}>
          <dl>
            <dd>Your {service} username:</dd>
            <dt>
              <input
                type="text"
                className="form-control"
                onChange={this.handleChange}
                value={librefmUsername}
                name="librefmUsername"
                placeholder="Username"
                size={30}
              />
            </dt>
          </dl>

          <button
            className="btn btn-success"
            type="submit"
            disabled={!librefmUsername}
          >
            Import listens
          </button>
        </form>
        {show && (
          <LibreFMImporterModal onClose={this.toggleModal} disable={!canClose}>
            <img
              src="/static/img/listenbrainz-logo.svg"
              height="75"
              className="img-fluid"
              alt=""
            />
            <br />
            <br />
            <div>{msg}</div>
            <br />
          </LibreFMImporterModal>
        )}
      </div>
    );
  }
}
