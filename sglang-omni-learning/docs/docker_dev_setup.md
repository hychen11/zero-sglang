# SGLang-Omni Docker 本地开发手册

在这台机器（RTX 5090 32 GB + RTX 4060 Laptop 8 GB）上，用 Docker 跑 sglang-omni、改代码、启动服务的完整流程。最后验证于 2026-11-23，sglang-omni 提交 `b62b0f94`。

## 当前状态

已跑通：`omni` 容器里用 RTX 5090 启动了 Qwen3-ASR-1.7B，转写测试返回 `How many cars are there in the picture?`，显存占用约 22.8 GB。

| 项目 | 值 |
| --- | --- |
| 镜像 | `hongccc/sglang-omni:dev` |
| 容器名 | `omni` |
| 宿主机代码目录 | `~/Desktop/sglang-omni` |
| 容器内代码目录 | `/workspace/sglang-omni`（挂载，同一份文件） |
| 模型缓存 | `~/.cache/huggingface`（挂载，宿主机和容器共用） |
| 容器内环境 | SGLang 0.5.23、torch 2.14.1+cu130，sglang-omni 0.2.0 可编辑安装 |
| 推荐 GPU | RTX 5090（`CUDA_DEVICE_ORDER=PCI_BUS_ID` 下编号为 1） |
| 服务地址 | `http://localhost:8000` |

已下载的模型：

| 模型 | 大小 | 用途 |
| --- | --- | --- |
| `Qwen/Qwen3-ASR-1.7B` | 4.4 GB | 语音转文字 |
| `wilsonzheng0327/Qwen3-ASR-1.7B-dflash` | 693 MB | ASR 的草稿模型（DFlash 投机解码）；5090 配置里关掉了 |
| `RedHatAI/Qwen3.8-27B-INT4` | 19 GB | 语言模型，compressed-tensors W4A16（group 128），SGLang 可直接加载；尚未实测 |

## 一次性准备（已完成，重装系统或删了容器才需要重做）

1. 把自己加进 docker 组，安装 NVIDIA Container Toolkit（需要 sudo）：

   ```bash
   sudo usermod -aG docker $USER
   # 安装 nvidia-container-toolkit 后：
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

   注销后重新登录，加组才生效。不想注销就在终端里执行 `newgrp docker`。

2. 检查容器能不能用 GPU，能列出两张卡就行：

   ```bash
   docker run --rm --gpus all ubuntu nvidia-smi
   ```

3. 拉镜像（压缩后约 18.9 GB）。在终端里跑能看到进度，结束时打印 `Status: Downloaded newer image`：

   ```bash
   docker pull hongccc/sglang-omni:dev
   ```

4. 创建 `omni` 容器（只创建一次）。`-d` 让它在后台运行；`SGLANG_OMNI_AUTO_CLONE=0` 必须加，否则镜像的启动脚本会对你的代码执行 `git pull`，而且会报 dubious ownership 导致容器直接退出：

   ```bash
   docker run -itd --name omni -e SGLANG_OMNI_AUTO_CLONE=0 \
     --shm-size 32g --gpus all --ipc host --network host --privileged \
     -v ~/Desktop/sglang-omni:/workspace/sglang-omni \
     -v ~/.cache/huggingface:/root/.cache/huggingface \
     hongccc/sglang-omni:dev /bin/zsh
   ```

5. 进容器，把代码以可编辑方式装进镜像自带的 Python。镜像里 SGLang、torch、flash-attn 都已装好，所以用 `--no-deps`：

   ```bash
   docker exec -it omni zsh
   git config --global --add safe.directory /workspace/sglang-omni
   cd /workspace/sglang-omni
   pip install --no-deps --no-build-isolation -e .
   which sgl-omni   # 应输出 /opt/sglang/bin/sgl-omni
   ```

## 日常启动流程

每次开机后从第 1 步开始。容器里装的东西不会丢，不需要重新 `docker run` 或重新安装。

1. 启动容器（在宿主机执行）。用 `docker ps` 看到 `omni` 的状态是 `Up` 就说明在运行：

   ```bash
   docker start omni
   ```

2. 进入容器。要开几个终端，就在几个终端里各执行一次。不要用 `docker start -ai omni`：用它进去后再退出，容器会停，里面的服务也会被杀掉：

   ```bash
   docker exec -it omni zsh
   ```

3. 下载模型（可选）。第一次 `serve` 时会自动下载，也可以提前下好。模型存在宿主机的 `~/.cache/huggingface`，删了容器也还在：

   ```bash
   hf download Qwen/Qwen3-ASR-1.7B
   ```

4. 启动服务（在容器里）。第一次启动约 40 秒。必须用 5090 的配置文件，不加的话会报 KV cache 显存不足：

   ```bash
   cd /workspace/sglang-omni
   CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 sgl-omni serve \
     --config examples/configs/qwen3_asr_rtx5090.yaml \
     --model-name Qwen/Qwen3-ASR-1.7B \
     --host 127.0.0.1 --port 8000
   ```

5. 检查服务是否启动好（在宿主机或第二个容器终端执行）。容器用的是 `--network host`，宿主机可以直接访问 localhost：

   ```bash
   curl -fsS http://localhost:8000/health
   ```

6. 发一个转写请求，应返回 `"text":"How many cars are there in the picture?"`：

   ```bash
   cd ~/Desktop/sglang-omni
   curl -fsS http://localhost:8000/v1/audio/transcriptions \
     -F model=Qwen/Qwen3-ASR-1.7B \
     -F file=@tests/data/query_to_cars.wav \
     -F response_format=json
   ```

7. 停止服务：在跑服务的终端按 Ctrl+C，或者在宿主机执行 `docker exec omni pkill -f "sgl-omni serve"`。不用了可以用 `docker stop omni` 把容器也停掉。

跑其他模型时，先看 `examples/configs/` 里有没有带 `rtx5090` 的配置文件，再看 [Cookbook](https://sgl-project.github.io/sglang-omni/) 里该模型的启动命令。

## 改代码后怎么跑

不需要编译。改完代码后停掉服务、重新 `serve` 就生效。sglang-omni 是纯 Python 项目，没有 C++/CUDA 扩展，可编辑安装（`-e`）让 Python 直接从 `/workspace/sglang-omni` 读代码，而这个目录就是宿主机上的 `~/Desktop/sglang-omni`。

日常循环：

1. 在宿主机上用 VS Code 改 `~/Desktop/sglang-omni` 里的代码。
2. 在跑服务的容器终端按 Ctrl+C 停掉服务。
3. 重新执行上面第 4 步的 `sgl-omni serve` 命令（按 ↑ 就能找到）。
4. 用第 5、6 步的 curl 测试。

已经在运行的服务不会自动加载新代码，必须重启。开启了 torch.compile 或 CUDA graph 的配置重启会慢一些，这是重新捕获和编译图，不需要你处理。

什么时候需要重新安装：

| 改了什么 | 要做什么 |
| --- | --- |
| `sglang_omni/` 下的 `.py` 代码 | 只重启服务 |
| `examples/configs/` 的 yaml 配置 | 只重启服务 |
| `pyproject.toml` 的命令行入口或 entry-points | 在容器里重新执行 `pip install --no-deps --no-build-isolation -e .` |
| `pyproject.toml` 的依赖版本，或 `git pull` 后依赖变了 | 先试 `pip install --no-build-isolation -e .`（不带 `--no-deps`）；如果涉及 SGLang/torch 大版本，重新 `docker pull` 新镜像并重建容器 |

调试时可以装 VS Code 的 Dev Containers 插件，用 Attach to Running Container 连到 `omni`，这样断点和 Python 解释器都用容器里的环境。

## 从 Mac 访问服务

模型只跑在服务器上，Mac 只负责录音、发送和显示结果，不需要装模型。服务保持 `--host 127.0.0.1`，在 Mac 上用 SSH 端口转发（`<服务器地址>` 填服务器的 Tailscale 或局域网 IP，`<用户名>` 填服务器上的登录名）：

```bash
ssh -N -L 8000:localhost:8000 <用户名>@<服务器地址>
```

之后 Mac 上访问 `localhost:8000` 就是服务器上的服务。浏览器只在 `https://` 或 `localhost` 下允许网页用麦克风，所以走端口转发后网页才能录音。

## 常见问题

下面都是这次配置过程中实际遇到过的问题。

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| `docker` 报 `permission denied ... docker.sock` | 当前终端还没拿到 docker 组权限 | 注销重新登录，或执行 `newgrp docker` |
| 启动容器就报 `detected dubious ownership` 并退出 | 镜像启动脚本以 root 身份对挂载的仓库执行 `git pull` | 创建容器时加 `-e SGLANG_OMNI_AUTO_CLONE=0`，进容器后设置 `git config --global --add safe.directory /workspace/sglang-omni` |
| 服务启动到一半退出，`exit 137` | 容器主 shell 退出，容器停止，服务被杀 | 用 `docker start omni` + `docker exec -it omni zsh`，不要用 `docker start -ai` |
| `Loaded weights leave no GPU memory for the KV cache under --mem-fraction-static=0.106` | 没加配置文件，自动选的显存比例太小，而且默认还加载了用于加速的草稿模型 | 加 `--config examples/configs/qwen3_asr_rtx5090.yaml`（显存比例 0.65，关掉草稿模型） |
| 选错了 GPU | `nvidia-smi` 里 0 号是 4060，但 CUDA 默认把最快的卡排在前面 | 加 `CUDA_DEVICE_ORDER=PCI_BUS_ID`，这时 5090 是 `CUDA_VISIBLE_DEVICES=1` |
| 宿主机上改文件或 `git checkout` 时提示没有权限 | 容器里以 root 身份写入的文件，在宿主机上属于 root | 在宿主机执行 `sudo chown -R $USER:$USER ~/Desktop/sglang-omni`；git 操作尽量在宿主机上做 |
| `docker pull` 中途断了 | 在终端里按了 Ctrl+C 或者关了终端 | 重新执行同一条 `docker pull`，已下好的层会跳过 |

## 命令速查表

| 想做什么 | 命令 | 在哪里执行 |
| --- | --- | --- |
| 启动容器 | `docker start omni` | 宿主机 |
| 进入容器（可开多个终端） | `docker exec -it omni zsh` | 宿主机 |
| 查看容器状态 | `docker ps -a` | 宿主机 |
| 启动服务 | `CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 sgl-omni serve --config examples/configs/qwen3_asr_rtx5090.yaml --model-name Qwen/Qwen3-ASR-1.7B --host 127.0.0.1 --port 8000` | 容器（`/workspace/sglang-omni`） |
| 检查服务 | `curl -fsS http://localhost:8000/health` | 宿主机或容器 |
| 停止服务 | Ctrl+C，或 `docker exec omni pkill -f "sgl-omni serve"` | 容器 / 宿主机 |
| 看 GPU 占用 | `nvidia-smi` | 宿主机或容器 |
| 改了入口或依赖后重装 | `pip install --no-deps --no-build-isolation -e .` | 容器 |
| 停止容器 | `docker stop omni` | 宿主机 |
| 删掉容器重建（代码和模型不受影响） | `docker rm -f omni`，然后按「一次性准备」第 4–5 步 | 宿主机 |
