package main

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	meowcaller "github.com/purpshell/meowcaller"
	"github.com/rs/zerolog"
	qrcode "github.com/skip2/go-qrcode"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	waLog "go.mau.fi/whatsmeow/util/log"
	"google.golang.org/protobuf/proto"

	_ "modernc.org/sqlite"
)

const (
	sampleRate        = 16000
	maxRequestBytes   = 8 << 20
	defaultListenAddr = "127.0.0.1:8787"
	defaultBridgeURL  = "http://127.0.0.1:8788/turn"
)

type config struct {
	listenAddr   string
	bridgeURL    string
	secret       string
	databasePath string
	pairMethod   string
	pairPhone    string
	pairDisplay  string
	allowed      map[string]struct{}
	turnSilence  time.Duration
	minSpeech    time.Duration
	maxTurn      time.Duration
	maxCall      time.Duration
}

type server struct {
	cfg    config
	ctx    context.Context
	wa     *whatsmeow.Client
	caller *meowcaller.Client
	log    zerolog.Logger

	mu          sync.Mutex
	active      *meowcaller.Call
	state       string
	peer        string
	startedAt   time.Time
	ready       bool
	processing  bool
	pcm         []int16
	musicPlayer *meowcaller.Player
	musicQueue  []musicItem
	speechStart int
	lastVoice   int
}

type statusResponse struct {
	Connected bool   `json:"connected"`
	LoggedIn  bool   `json:"loggedIn"`
	State     string `json:"state"`
	Peer      string `json:"peer,omitempty"`
}

type turnResponse struct {
	Transcript string `json:"transcript"`
	Reply      string `json:"reply"`
	Audio      string `json:"audio"`
	Format     string `json:"format"`
}

type musicItem struct {
	source meowcaller.AudioSource
	path   string
	format string
	url    string
}

func main() {
	loadDotEnv()
	cfg, err := loadConfig()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	level := zerolog.WarnLevel
	if configured := strings.TrimSpace(os.Getenv("MEOW_LOG_LEVEL")); configured != "" {
		if parsed, parseErr := zerolog.ParseLevel(configured); parseErr == nil {
			level = parsed
		}
	}
	console := zerolog.ConsoleWriter{Out: os.Stderr, NoColor: true, TimeFormat: "15:04:05"}
	logger := zerolog.New(console).Level(level).With().Timestamp().Logger()
	ctx, stop := signal.NotifyContext(logger.WithContext(context.Background()), os.Interrupt, syscall.SIGTERM)
	defer stop()

	wa, caller, err := connect(ctx, cfg, logger)
	if err != nil {
		logger.Fatal().Err(err).Msg("WhatsApp call client gagal dimulai")
	}
	defer wa.Disconnect()

	s := &server{cfg: cfg, ctx: ctx, wa: wa, caller: caller, log: logger, state: "idle"}
	caller.OnIncomingCall(s.handleIncoming)

	httpServer := &http.Server{Addr: cfg.listenAddr, Handler: s.routes(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		logger.Info().Str("addr", cfg.listenAddr).Msg("call service API aktif")
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatal().Err(err).Msg("call service API berhenti")
		}
	}()
	<-ctx.Done()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func defaultSessionPath() string {
	if executable, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(executable), "wa-voip.db")
	}
	return "wa-voip.db"
}

func loadConfig() (config, error) {
	secret := strings.TrimSpace(os.Getenv("CALL_SERVICE_SECRET"))
	if secret == "" {
		return config{}, errors.New("CALL_SERVICE_SECRET wajib diisi dan harus sama dengan service Node")
	}
	allowed := make(map[string]struct{})
	for _, value := range strings.Split(os.Getenv("ID_OWNER"), ",") {
		if number := digits(value); number != "" {
			allowed[number] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return config{}, errors.New("ID_OWNER wajib diisi untuk allowlist POC call")
	}
	return config{
		listenAddr:   env("CALL_SERVICE_ADDR", defaultListenAddr),
		bridgeURL:    env("CALL_AI_BRIDGE_URL", defaultBridgeURL),
		secret:       secret,
		databasePath: env("CALL_SESSION_DB", defaultSessionPath()),
		pairMethod:   strings.ToLower(env("CALL_PAIRING_METHOD", "code")),
		pairPhone:    digits(env("CALL_PAIRING_PHONE", os.Getenv("WA_PHONE_NUMBER"))),
		pairDisplay:  env("CALL_PAIRING_DISPLAY_NAME", "Chrome (Linux)"),
		allowed:      allowed,
		turnSilence:  durationEnv("CALL_TURN_SILENCE", 1200*time.Millisecond),
		minSpeech:    durationEnv("CALL_MIN_SPEECH", 700*time.Millisecond),
		maxTurn:      durationEnv("CALL_MAX_TURN", 15*time.Second),
		maxCall:      durationEnv("CALL_MAX_DURATION", 5*time.Minute),
	}, nil
}

func connect(ctx context.Context, cfg config, log zerolog.Logger) (*whatsmeow.Client, *meowcaller.Client, error) {
	store.DeviceProps.Os = proto.String("Shiroko AI Call")
	store.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()
	dbPath, err := filepath.Abs(cfg.databasePath)
	if err != nil {
		return nil, nil, err
	}
	container, err := sqlstore.New(ctx, "sqlite", "file:"+dbPath+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", waLog.Zerolog(log).Sub("db"))
	if err != nil {
		return nil, nil, fmt.Errorf("buka session DB: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("baca session DB: %w", err)
	}
	wa := whatsmeow.NewClient(device, waLog.Zerolog(log).Sub("wa"))
	caller := meowcaller.NewClient(wa, meowcaller.WithLogger(log))
	needsPairing := wa.Store.ID == nil
	if needsPairing {
		qr, err := wa.GetQRChannel(ctx)
		if err != nil {
			return nil, nil, err
		}
		if err := wa.Connect(); err != nil {
			return nil, nil, err
		}
		if cfg.pairMethod == "code" {
			if cfg.pairPhone == "" {
				return nil, nil, errors.New("CALL_PAIRING_PHONE atau WA_PHONE_NUMBER wajib diisi untuk pairing code")
			}
			select {
			case event := <-qr:
				log.Info().Str("event", event.Event).Msg("pairing channel siap; QR diabaikan")
			case <-time.After(10 * time.Second):
				return nil, nil, errors.New("timeout menunggu pairing channel WhatsApp")
			case <-ctx.Done():
				return nil, nil, ctx.Err()
			}
			code, err := wa.PairPhone(ctx, cfg.pairPhone, false, whatsmeow.PairClientChrome, cfg.pairDisplay)
			if err != nil {
				return nil, nil, fmt.Errorf("buat pairing code: %w", err)
			}
			fmt.Fprintf(os.Stderr, "\nKODE PAIRING: %s\n\nCara pairing:\nWhatsApp -> Perangkat tertaut -> Tautkan perangkat\n-> Tautkan dengan nomor telepon\n-> Masukkan kode di atas\n\n", code)
		} else {
			for event := range qr {
				if event.Event == "code" {
					path := env("CALL_QR_PATH", "pairing-qr.png")
					if err := writeQR(event.Code, path); err != nil {
						log.Error().Err(err).Msg("gagal menulis QR")
					} else {
						log.Warn().Str("path", path).Msg("scan QR ini dari WhatsApp > Perangkat tertaut")
					}
				} else {
					log.Info().Str("event", event.Event).Msg("pairing event")
				}
			}
		}
	} else if err := wa.Connect(); err != nil {
		return nil, nil, err
	}
	if err := waitReady(ctx, wa, 60*time.Second); err != nil {
		return nil, nil, err
	}
	if wa.Store.PushName == "" {
		wa.Store.PushName = "Shiroko AI Call"
	}
	if err := wa.SendPresence(ctx, types.PresenceAvailable); err != nil {
		log.Warn().Err(err).Msg("presence gagal")
	}
	_ = os.Remove(env("CALL_QR_PATH", "pairing-qr.png"))
	if needsPairing {
		log.Warn().Msg("PAIRING BERHASIL - call service siap digunakan")
	} else {
		log.Warn().Msg("CALL SERVICE SIAP DIGUNAKAN")
	}
	return wa, caller, nil
}

func waitReady(ctx context.Context, wa *whatsmeow.Client, timeout time.Duration) error {
	ready := make(chan struct{}, 2)
	id := wa.AddEventHandler(func(evt any) {
		if _, ok := evt.(*events.Connected); ok {
			select {
			case ready <- struct{}{}:
			default:
			}
		}
	})
	defer wa.RemoveEventHandler(id)
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for !(wa.IsConnected() && wa.IsLoggedIn()) {
		select {
		case <-ready:
		case <-timer.C:
			return errors.New("timeout menunggu koneksi WhatsApp")
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return nil
}

func writeQR(code, path string) error {
	if parent := filepath.Dir(path); parent != "." {
		if err := os.MkdirAll(parent, 0700); err != nil {
			return err
		}
	}
	pngBytes, err := qrcode.Encode(code, qrcode.Medium, 512)
	if err != nil {
		return err
	}
	if _, err := png.Decode(bytes.NewReader(pngBytes)); err != nil {
		return err
	}
	return os.WriteFile(path, pngBytes, 0600)
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.auth(func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]bool{"ok": true}) }))
	mux.HandleFunc("GET /status", s.auth(s.statusHandler))
	mux.HandleFunc("POST /call", s.auth(s.callHandler))
	mux.HandleFunc("POST /hangup", s.auth(s.hangupHandler))
	mux.HandleFunc("POST /music/play", s.auth(s.musicPlayHandler))
	mux.HandleFunc("POST /music/pause", s.auth(s.musicPauseHandler))
	mux.HandleFunc("POST /music/resume", s.auth(s.musicResumeHandler))
	mux.HandleFunc("POST /music/skip", s.auth(s.musicSkipHandler))
	mux.HandleFunc("POST /music/stop", s.auth(s.musicStopHandler))
	mux.HandleFunc("GET /music/queue", s.auth(s.musicQueueHandler))
	return http.MaxBytesHandler(mux, maxRequestBytes)
}

func (s *server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		given := r.Header.Get("x-call-secret")
		if len(given) != len(s.cfg.secret) || subtle.ConstantTimeCompare([]byte(given), []byte(s.cfg.secret)) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	}
}

func (s *server) statusHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	state, peer := s.state, s.peer
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, statusResponse{Connected: s.wa.IsConnected(), LoggedIn: s.wa.IsLoggedIn(), State: state, Peer: peer})
}

func (s *server) callHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON tidak valid"})
		return
	}
	target := digits(req.Target)
	if !s.isAllowed(target) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "target tidak ada dalam ID_OWNER"})
		return
	}
	s.mu.Lock()
	busy := s.active != nil
	s.mu.Unlock()
	if busy {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "masih ada panggilan aktif"})
		return
	}
	call, err := s.caller.Call(r.Context(), "+"+target)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
		return
	}
	s.attach(call, target, "ringing")
	writeJSON(w, http.StatusAccepted, map[string]string{"state": "ringing", "peer": target})
}

func (s *server) hangupHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	call := s.active
	s.mu.Unlock()
	if call != nil {
		_ = call.Hangup()
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) musicPlayHandler(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "JSON tidak valid"})
		return
	}
	item, err := s.downloadMusic(r.Context(), req.URL)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	s.mu.Lock()
	if s.active == nil || !s.ready {
		s.mu.Unlock()
		_ = item.source.Close()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tidak ada call aktif"})
		return
	}
	s.musicQueue = append(s.musicQueue, item)
	position := len(s.musicQueue)
	if s.musicPlayer == nil {
		s.startNextMusicLocked()
		position = 0
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "position": position, "url": req.URL})
}

func (s *server) musicPauseHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	player := s.musicPlayer
	s.mu.Unlock()
	if player == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tidak ada musik yang sedang diputar"})
		return
	}
	player.Pause()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) musicResumeHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	player := s.musicPlayer
	s.mu.Unlock()
	if player == nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tidak ada musik yang sedang diputar"})
		return
	}
	player.Resume()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) musicSkipHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	player := s.musicPlayer
	if player == nil {
		s.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "tidak ada musik yang sedang diputar"})
		return
	}
	s.musicPlayer = nil
	player.Stop()
	s.startNextMusicLocked()
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) musicStopHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	player := s.musicPlayer
	queued := s.musicQueue
	s.musicQueue = nil
	s.mu.Unlock()
	if player != nil {
		player.Stop()
	}
	for _, item := range queued {
		_ = item.source.Close()
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *server) musicQueueHandler(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	playing := s.musicPlayer != nil
	count := len(s.musicQueue)
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"playing": playing, "queued": count})
}

func (s *server) downloadMusic(ctx context.Context, rawURL string) (musicItem, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return musicItem{}, errors.New("URL musik harus berupa http/https yang valid")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return musicItem{}, err
	}
	request.Header.Set("User-Agent", "ShirokoCall/1.0")
	response, err := (&http.Client{Timeout: 60 * time.Second}).Do(request)
	if err != nil {
		return musicItem{}, fmt.Errorf("download musik gagal: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return musicItem{}, fmt.Errorf("download musik HTTP %d", response.StatusCode)
	}
	if response.ContentLength > 32<<20 {
		return musicItem{}, errors.New("file musik terlalu besar; batas 32 MB")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 32<<20+1))
	if err != nil {
		return musicItem{}, err
	}
	if len(data) > 32<<20 {
		return musicItem{}, errors.New("file musik terlalu besar; batas 32 MB")
	}
	ext := strings.ToLower(filepath.Ext(parsed.Path))
	if ext != ".mp3" && ext != ".wav" && ext != ".opus" {
		return musicItem{}, errors.New("URL harus berakhiran .mp3, .wav, atau .opus")
	}
	path := filepath.Join(os.TempDir(), fmt.Sprintf("shiroko-music-%d%s", time.Now().UnixNano(), ext))
	if err := os.WriteFile(path, data, 0600); err != nil {
		return musicItem{}, err
	}
	var source meowcaller.AudioSource
	switch ext {
	case ".mp3":
		source, err = meowcaller.MP3File(path)
	case ".wav":
		source, err = meowcaller.WAVFile(path)
	case ".opus":
		source, err = meowcaller.OpusFile(path)
	}
	if err != nil {
		_ = os.Remove(path)
		return musicItem{}, fmt.Errorf("decode musik gagal: %w", err)
	}
	return musicItem{source: &removeOnCloseSource{AudioSource: source, path: path}, path: path, format: strings.TrimPrefix(ext, "."), url: parsed.String()}, nil
}

func (s *server) startNextMusicLocked() {
	if len(s.musicQueue) == 0 || s.active == nil {
		s.musicPlayer = nil
		return
	}
	item := s.musicQueue[0]
	s.musicQueue = s.musicQueue[1:]
	player := meowcaller.NewPlayer()
	s.musicPlayer = player
	player.OnFinish(func() {
		s.mu.Lock()
		if s.musicPlayer == player {
			s.musicPlayer = nil
			s.startNextMusicLocked()
		}
		s.mu.Unlock()
	})
	player.Play(item.source)
	call := s.active
	call.Subscribe(player)
}

func (s *server) handleIncoming(call *meowcaller.Call) {
	peer := s.peerNumber(call.Peer())
	if !s.isAllowed(peer) {
		s.log.Warn().Str("peer", call.Peer().String()).Msg("incoming call ditolak: bukan owner")
		_ = call.Reject()
		return
	}
	s.mu.Lock()
	busy := s.active != nil
	s.mu.Unlock()
	if busy {
		_ = call.Reject()
		return
	}
	if err := call.Answer(); err != nil {
		s.log.Error().Err(err).Msg("gagal menjawab panggilan")
		return
	}
	s.attach(call, peer, "active")
}

func (s *server) attach(call *meowcaller.Call, peer, state string) {
	s.mu.Lock()
	s.active, s.peer, s.state, s.startedAt = call, peer, state, time.Now()
	s.ready, s.processing, s.pcm = false, false, nil
	s.speechStart, s.lastVoice = -1, -1
	s.mu.Unlock()

	call.Receive(meowcaller.SinkFunc(func(frame []float32) { s.receiveFrame(call, frame) }))
	call.OnReady(func() {
		s.mu.Lock()
		if s.active == call {
			s.ready, s.state = true, "active"
		}
		s.mu.Unlock()
	})
	call.OnEnd(func(reason string) { s.finish(call, reason) })
	call.OnStateChange(func(phase meowcaller.CallPhase) {
		s.log.Info().Int("phase", int(phase)).Str("peer", peer).Msg("call state")
	})
	go func() {
		timer := time.NewTimer(s.cfg.maxCall)
		defer timer.Stop()
		select {
		case <-timer.C:
			s.mu.Lock()
			active := s.active == call
			s.mu.Unlock()
			if active {
				_ = call.Hangup()
			}
		case <-s.ctx.Done():
		}
	}()
}

func (s *server) receiveFrame(call *meowcaller.Call, frame []float32) {
	s.mu.Lock()
	if s.active != call || !s.ready || s.processing {
		s.mu.Unlock()
		return
	}
	voice := frameRMS(frame) >= 0.012
	if s.speechStart < 0 && !voice {
		s.mu.Unlock()
		return
	}
	if s.speechStart < 0 {
		s.speechStart = len(s.pcm)
	}
	for _, sample := range frame {
		value := sample * 32768
		if value > 32767 {
			value = 32767
		}
		if value < -32768 {
			value = -32768
		}
		s.pcm = append(s.pcm, int16(value))
	}
	if voice {
		s.lastVoice = len(s.pcm)
	}
	speechSamples := len(s.pcm) - s.speechStart
	silenceSamples := len(s.pcm) - s.lastVoice
	shouldFlush := (time.Duration(silenceSamples)*time.Second/time.Duration(sampleRate) >= s.cfg.turnSilence && time.Duration(speechSamples)*time.Second/time.Duration(sampleRate) >= s.cfg.minSpeech) || time.Duration(speechSamples)*time.Second/time.Duration(sampleRate) >= s.cfg.maxTurn
	if shouldFlush {
		pcm := append([]int16(nil), s.pcm[s.speechStart:]...)
		s.processing, s.state = true, "processing"
		s.pcm, s.speechStart, s.lastVoice = nil, -1, -1
		s.mu.Unlock()
		go s.processTurn(call, pcm)
		return
	}
	s.mu.Unlock()
}

func (s *server) processTurn(call *meowcaller.Call, pcm []int16) {
	wav := wavBytes(pcm)
	payload, _ := json.Marshal(map[string]string{"peer": s.currentPeer(call), "audio": base64.StdEncoding.EncodeToString(wav)})
	req, err := http.NewRequestWithContext(s.ctx, http.MethodPost, s.cfg.bridgeURL, bytes.NewReader(payload))
	if err == nil {
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-call-secret", s.cfg.secret)
		client := &http.Client{Timeout: 95 * time.Second}
		var response *http.Response
		response, err = client.Do(req)
		if err == nil {
			defer response.Body.Close()
			body, readErr := io.ReadAll(io.LimitReader(response.Body, maxRequestBytes))
			if readErr != nil {
				err = readErr
			} else if response.StatusCode != http.StatusOK {
				err = fmt.Errorf("AI bridge HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
			} else {
				var turn turnResponse
				if decodeErr := json.Unmarshal(body, &turn); decodeErr != nil {
					err = decodeErr
				} else {
					err = s.playTurn(call, turn)
				}
			}
		}
	}
	if err != nil {
		s.log.Error().Err(err).Msg("gagal memproses giliran call")
	}
	s.mu.Lock()
	if s.active == call {
		s.processing, s.state = false, "active"
	}
	s.mu.Unlock()
}

func (s *server) playTurn(call *meowcaller.Call, turn turnResponse) error {
	audio, err := base64.StdEncoding.DecodeString(turn.Audio)
	if err != nil {
		return err
	}
	var source meowcaller.AudioSource
	switch strings.ToLower(turn.Format) {
	case "wav", "mp3", "":
		ext := strings.ToLower(turn.Format)
		if ext == "" {
			ext = "mp3"
		}
		path := filepath.Join(os.TempDir(), fmt.Sprintf("shiroko-call-%d.%s", time.Now().UnixNano(), ext))
		if err := os.WriteFile(path, audio, 0600); err != nil {
			return err
		}
		if ext == "wav" {
			source, err = meowcaller.WAVFile(path)
		} else {
			source, err = meowcaller.MP3File(path)
		}
		if err != nil {
			_ = os.Remove(path)
			return err
		}
		player := meowcaller.NewPlayer()
		call.Subscribe(player)
		done := make(chan struct{}, 1)
		player.OnFinish(func() {
			select {
			case done <- struct{}{}:
			default:
			}
		})
		player.Play(&removeOnCloseSource{AudioSource: source, path: path})
		select {
		case <-done:
			return nil
		case <-time.After(60 * time.Second):
			player.Stop()
			return errors.New("timeout playback TTS")
		case <-s.ctx.Done():
			return s.ctx.Err()
		}
	default:
		return fmt.Errorf("format TTS tidak didukung sidecar: %s", turn.Format)
	}
}

type removeOnCloseSource struct {
	meowcaller.AudioSource
	path string
}

func (s *removeOnCloseSource) Close() error {
	err := s.AudioSource.Close()
	_ = os.Remove(s.path)
	return err
}

func (s *server) finish(call *meowcaller.Call, reason string) {
	s.mu.Lock()
	if s.active == call {
		player := s.musicPlayer
		queued := s.musicQueue
		s.musicPlayer = nil
		s.musicQueue = nil
		s.active, s.peer, s.state = nil, "", "idle"
		s.ready, s.processing, s.pcm = false, false, nil
		if player != nil {
			player.Stop()
		}
		for _, item := range queued {
			_ = item.source.Close()
		}
	}
	s.mu.Unlock()
	s.log.Info().Str("reason", reason).Msg("panggilan selesai")
}

func (s *server) currentPeer(call *meowcaller.Call) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active != call {
		return ""
	}
	return s.peer
}

func (s *server) peerNumber(jid types.JID) string {
	if jid.Server == types.HiddenUserServer {
		if pn, err := s.wa.Store.LIDs.GetPNForLID(s.ctx, jid); err == nil && !pn.IsEmpty() {
			return digits(pn.User)
		}
	}
	return digits(jid.User)
}

func (s *server) isAllowed(number string) bool { _, ok := s.cfg.allowed[digits(number)]; return ok }

func frameRMS(frame []float32) float64 {
	if len(frame) == 0 {
		return 0
	}
	var sum float64
	for _, sample := range frame {
		sum += float64(sample * sample)
	}
	return math.Sqrt(sum / float64(len(frame)))
}

func wavBytes(samples []int16) []byte {
	buf := bytes.NewBuffer(make([]byte, 0, 44+len(samples)*2))
	buf.WriteString("RIFF")
	_ = binary.Write(buf, binary.LittleEndian, uint32(36+len(samples)*2))
	buf.WriteString("WAVEfmt ")
	_ = binary.Write(buf, binary.LittleEndian, uint32(16))
	_ = binary.Write(buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(buf, binary.LittleEndian, uint16(1))
	_ = binary.Write(buf, binary.LittleEndian, uint32(sampleRate))
	_ = binary.Write(buf, binary.LittleEndian, uint32(sampleRate*2))
	_ = binary.Write(buf, binary.LittleEndian, uint16(2))
	_ = binary.Write(buf, binary.LittleEndian, uint16(16))
	buf.WriteString("data")
	_ = binary.Write(buf, binary.LittleEndian, uint32(len(samples)*2))
	_ = binary.Write(buf, binary.LittleEndian, samples)
	return buf.Bytes()
}

func loadDotEnv() {
	candidates := []string{".env", "../.env"}
	if executable, err := os.Executable(); err == nil {
		dir := filepath.Dir(executable)
		candidates = append(candidates, filepath.Join(dir, ".env"), filepath.Join(dir, "..", ".env"))
	}
	for _, candidate := range candidates {
		data, err := os.ReadFile(candidate)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			key, value, ok := strings.Cut(line, "=")
			if !ok {
				continue
			}
			key, value = strings.TrimSpace(key), strings.TrimSpace(value)
			if key == "" {
				continue
			}
			if len(value) >= 2 && ((value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'')) {
				value = value[1 : len(value)-1]
			}
			if _, exists := os.LookupEnv(key); !exists {
				_ = os.Setenv(key, value)
			}
		}
		return
	}
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func digits(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r >= '0' && r <= '9' {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func durationEnv(key string, fallback time.Duration) time.Duration {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		if parsed, err := time.ParseDuration(value); err == nil {
			return parsed
		}
	}
	return fallback
}
