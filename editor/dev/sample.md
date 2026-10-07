# 傅里叶变换笔记
#读书/数学 #公式

把一个函数拆成不同**频率**的正弦波之和，是*信号处理*的基础。代码里常写成 `np.fft.fft(x)`，详见 [维基百科](https://zh.wikipedia.org/wiki/傅里叶变换)。

## 定义

连续傅里叶变换：

$$
\hat{f}(\xi) = \int_{-\infty}^{\infty} f(x)\, e^{-2\pi i x \xi}\, dx
$$

其中 $\xi$ 是频率，$e^{i\theta} = \cos\theta + i\sin\theta$。花了 $5 买书不是公式。

## 要点

- 时域卷积等于频域乘积
- 能量守恒（Parseval 定理）
  - 嵌套的一项
1. 先采样
2. 再做 FFT

- [x] 读完第三章
- [ ] 推一遍卷积定理
- [ ] 写个 Python 小例子

> 数学是上帝用来书写宇宙的文字。
> —— 伽利略

### 代码

```python
import numpy as np

def spectrum(x):
    # 只要正频率那一半
    return np.abs(np.fft.rfft(x)) / len(x)
```

| 变换 | 公式 | 用途 |
|:--|:-:|--:|
| 傅里叶 | $\hat f(\xi)$ | 频谱 |
| 拉普拉斯 | $F(s)$ | **控制**系统 |

---

![频谱图](../附件/spectrum.png)

最后一段，~~删掉的话~~ 和 #想法 标签。
